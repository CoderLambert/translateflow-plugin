package siwc

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeSecureBlob struct {
	mu        sync.Mutex
	value     []byte
	readErr   error
	writeErr  error
	readGate  chan struct{}
	readCall  chan struct{}
	writeGate chan struct{}
	writeCall chan struct{}
}

type observedRefreshStore struct {
	CredentialStore
	entered chan<- struct{}
}

func (s *observedRefreshStore) AcquireRefreshLock(ctx context.Context) (func(), error) {
	s.entered <- struct{}{}
	return s.CredentialStore.AcquireRefreshLock(ctx)
}

func (b *fakeSecureBlob) Read(ctx context.Context) ([]byte, error) {
	if b.readGate != nil {
		select {
		case b.readCall <- struct{}{}:
		default:
		}
		select {
		case <-b.readGate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.readErr != nil {
		return nil, b.readErr
	}
	if b.value == nil {
		return nil, ErrSecureBlobNotFound
	}
	return bytes.Clone(b.value), nil
}

func (b *fakeSecureBlob) Write(ctx context.Context, value []byte) error {
	if b.writeGate != nil {
		select {
		case b.writeCall <- struct{}{}:
		default:
		}
		select {
		case <-b.writeGate:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.writeErr != nil {
		return b.writeErr
	}
	b.value = bytes.Clone(value)
	return nil
}

func newPersistentStoreForTest(t *testing.T, blob SecureBlobStore, lockDir string) *PersistentStore {
	t.Helper()
	store, err := NewPersistentStore(blob, lockDir)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func TestRecreatedPersistentStoreRestoresFromFakeSecureBlob(t *testing.T) {
	ctx := context.Background()
	blob := &fakeSecureBlob{}
	lockDir := filepath.Join(t.TempDir(), "locks")
	first := newPersistentStoreForTest(t, blob, lockDir)
	now := time.Now().UTC().Truncate(time.Second)
	registration := Registration{
		ClientID: testIssuedClientID,
		HostID:   "urn:uuid:stable-host",
		Subject:  "offline-test-subject",
		Email:    "offline@example.invalid",
	}
	tokens := SessionTokens{
		IDToken:      "offline-id-token",
		AccessToken:  "offline-access-token",
		RefreshToken: "offline-refresh-token",
		Scopes:       []string{planUseScope, "offline_access"},
		Expiry:       now.Add(time.Hour),
	}
	committed, err := first.CommitAuth(ctx, 0, registration, tokens)
	if err != nil || !committed {
		t.Fatalf("CommitAuth() = committed:%v err:%v", committed, err)
	}

	// This simulates store recreation over a fake backend. It does not exercise
	// an actual host process restart or either system credential service.
	recreated := newPersistentStoreForTest(t, blob, lockDir)
	snapshot, err := recreated.Snapshot(ctx)
	if err != nil || !snapshot.HasRegistration || !snapshot.HasSession {
		t.Fatalf("recreated Snapshot() = %#v, err=%v", snapshot, err)
	}
	if snapshot.Registration != registration || snapshot.Tokens.AccessToken != tokens.AccessToken ||
		snapshot.Tokens.RefreshToken != tokens.RefreshToken || snapshot.Generation != 1 {
		t.Fatalf("restored snapshot = %#v", snapshot)
	}
}

func TestPersistentStoreReturnsExplicitErrorsForUnavailableAndCorruptData(t *testing.T) {
	ctx := context.Background()
	blob := &fakeSecureBlob{readErr: errors.New("secret service is locked")}
	store := newPersistentStoreForTest(t, blob, filepath.Join(t.TempDir(), "locks"))
	if _, err := store.Snapshot(ctx); !errors.Is(err, ErrSecureStoreUnavailable) {
		t.Fatalf("locked secure store error = %v, want ErrSecureStoreUnavailable", err)
	}

	blob.mu.Lock()
	blob.readErr = nil
	blob.value = []byte(`{"version":1,"generation":4,"registration":{"client_id":"incomplete"}}`)
	blob.mu.Unlock()
	if _, err := store.Snapshot(ctx); !errors.Is(err, ErrCredentialRecordInvalid) {
		t.Fatalf("corrupt credential record error = %v, want ErrCredentialRecordInvalid", err)
	}
	blob.mu.Lock()
	blob.value = nil
	blob.writeErr = errors.New("secret service is unavailable")
	blob.mu.Unlock()
	registration := Registration{ClientID: testIssuedClientID, HostID: "urn:uuid:stable-host", Subject: "offline-test-subject"}
	tokens := SessionTokens{AccessToken: "offline-access-token", Expiry: time.Now().Add(time.Hour)}
	if committed, err := store.CommitAuth(ctx, 0, registration, tokens); committed || !errors.Is(err, ErrSecureStoreUnavailable) {
		t.Fatalf("failed secure write = committed:%v err:%v, want an explicit unavailable error", committed, err)
	}
}

func TestPersistentStoreReadCancellationReleasesStateLock(t *testing.T) {
	blob := &fakeSecureBlob{readGate: make(chan struct{}), readCall: make(chan struct{}, 1)}
	lockDir := filepath.Join(t.TempDir(), "locks")
	blocked := newPersistentStoreForTest(t, blob, lockDir)
	otherStore := newPersistentStoreForTest(t, blob, lockDir)
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := blocked.Snapshot(ctx)
		result <- err
	}()
	select {
	case <-blob.readCall:
	case <-time.After(2 * time.Second):
		cancel()
		t.Fatal("fake secure Read did not enter its blocked call")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled Snapshot() error = %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled secure Read did not return")
	}
	close(blob.readGate)
	snapshot, err := otherStore.Snapshot(context.Background())
	if err != nil || snapshot.HasSession || snapshot.HasRegistration {
		t.Fatalf("state lock was not reusable after cancelled Read: snapshot=%#v err=%v", snapshot, err)
	}
}

func TestPersistentStoreWriteCancellationLeavesNoLateTokenWrite(t *testing.T) {
	blob := &fakeSecureBlob{writeGate: make(chan struct{}), writeCall: make(chan struct{}, 1)}
	lockDir := filepath.Join(t.TempDir(), "locks")
	blocked := newPersistentStoreForTest(t, blob, lockDir)
	otherStore := newPersistentStoreForTest(t, blob, lockDir)
	ctx, cancel := context.WithCancel(context.Background())
	registration := Registration{ClientID: testIssuedClientID, HostID: "urn:uuid:cancel-host", Subject: "offline-test-subject"}
	tokens := SessionTokens{AccessToken: "late-token-must-not-commit", Expiry: time.Now().Add(time.Hour)}
	result := make(chan error, 1)
	go func() {
		_, err := blocked.CommitAuth(ctx, 0, registration, tokens)
		result <- err
	}()
	select {
	case <-blob.writeCall:
	case <-time.After(2 * time.Second):
		cancel()
		t.Fatal("fake secure Write did not enter its blocked call")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled CommitAuth() error = %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled secure Write did not return")
	}
	close(blob.writeGate)
	snapshot, err := otherStore.Snapshot(context.Background())
	if err != nil || snapshot.HasSession || snapshot.HasRegistration {
		t.Fatalf("cancelled Write left a late credential or held state lock: snapshot=%#v err=%v", snapshot, err)
	}
	blob.mu.Lock()
	stored := bytes.Clone(blob.value)
	blob.mu.Unlock()
	if stored != nil {
		t.Fatalf("cancelled Write changed the secure blob after it returned: %q", stored)
	}
}

func TestHostLockSubprocessCompetitionAndRelease(t *testing.T) {
	lockDir := filepath.Join(t.TempDir(), "host-lock")
	hold := hostLockHelperCommand(lockDir, "hold")
	stdout, err := hold.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdin, err := hold.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := hold.Start(); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "LOCKED" {
		_ = stdin.Close()
		_ = hold.Wait()
		t.Fatalf("first host lock helper output = %q, err=%v", line, err)
	}
	if output, err := hostLockHelperCommand(lockDir, "probe").CombinedOutput(); err != nil || strings.TrimSpace(string(output)) != "HOST_BUSY" {
		_ = stdin.Close()
		_ = hold.Wait()
		t.Fatalf("competing process output = %q, err=%v; want HOST_BUSY", output, err)
	}
	if err := stdin.Close(); err != nil {
		_ = hold.Wait()
		t.Fatal(err)
	}
	if err := hold.Wait(); err != nil {
		t.Fatalf("lock holder exit = %v", err)
	}
	if output, err := hostLockHelperCommand(lockDir, "probe").CombinedOutput(); err != nil || strings.TrimSpace(string(output)) != "FREE" {
		t.Fatalf("released lock probe output = %q, err=%v; want FREE", output, err)
	}
	exitedHolder := hostLockHelperCommand(lockDir, "exit-held")
	exitedOutput, err := exitedHolder.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := exitedHolder.Start(); err != nil {
		t.Fatal(err)
	}
	line, err = bufio.NewReader(exitedOutput).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "LOCKED" {
		t.Fatalf("exiting lock helper output = %q, err=%v", line, err)
	}
	if err := exitedHolder.Wait(); err != nil {
		t.Fatalf("exiting lock helper exit = %v", err)
	}
	if output, err := hostLockHelperCommand(lockDir, "probe").CombinedOutput(); err != nil || strings.TrimSpace(string(output)) != "FREE" {
		t.Fatalf("process-exit lock probe output = %q, err=%v; want FREE", output, err)
	}
}

func TestHostLockSubprocessHelper(t *testing.T) {
	mode := os.Getenv("TRANSLATEFLOW_HOST_LOCK_TEST_MODE")
	if mode == "" {
		return
	}
	release, err := AcquireHostLock(os.Getenv("TRANSLATEFLOW_HOST_LOCK_TEST_DIR"))
	if errors.Is(err, ErrHostBusy) {
		_, _ = fmt.Fprintln(os.Stdout, "HOST_BUSY")
		os.Exit(0)
	}
	if err != nil {
		_, _ = fmt.Fprintln(os.Stdout, "LOCK_ERROR")
		os.Exit(1)
	}
	if mode == "hold" {
		_, _ = fmt.Fprintln(os.Stdout, "LOCKED")
		_, _ = io.Copy(io.Discard, os.Stdin)
		release()
		os.Exit(0)
	}
	if mode == "exit-held" {
		_, _ = fmt.Fprintln(os.Stdout, "LOCKED")
		os.Exit(0)
	}
	release()
	if mode == "probe" {
		_, _ = fmt.Fprintln(os.Stdout, "FREE")
	}
	os.Exit(0)
}

func hostLockHelperCommand(lockDir, mode string) *exec.Cmd {
	command := exec.Command(os.Args[0], "-test.run=^TestHostLockSubprocessHelper$")
	command.Env = append(os.Environ(),
		"TRANSLATEFLOW_HOST_LOCK_TEST_MODE="+mode,
		"TRANSLATEFLOW_HOST_LOCK_TEST_DIR="+lockDir,
	)
	return command
}

func TestPersistentStoreLogoutRejectsStaleGenerationWrites(t *testing.T) {
	ctx := context.Background()
	blob := &fakeSecureBlob{}
	lockDir := filepath.Join(t.TempDir(), "locks")
	oldProcess := newPersistentStoreForTest(t, blob, lockDir)
	registration := Registration{ClientID: testIssuedClientID, HostID: "urn:uuid:stable-host", Subject: "offline-test-subject"}
	tokens := SessionTokens{IDToken: "offline-id-token", AccessToken: "offline-access-token", RefreshToken: "offline-refresh-token", Scopes: []string{planUseScope}, Expiry: time.Now().Add(time.Hour)}
	if committed, err := oldProcess.CommitAuth(ctx, 0, registration, tokens); err != nil || !committed {
		t.Fatalf("initial CommitAuth() = committed:%v err:%v", committed, err)
	}
	stale, err := oldProcess.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}

	logoutProcess := newPersistentStoreForTest(t, blob, lockDir)
	cleared, err := logoutProcess.InvalidateSession(ctx)
	if err != nil || cleared.RefreshToken != tokens.RefreshToken {
		t.Fatalf("InvalidateSession() = %#v, err=%v", cleared, err)
	}
	refreshed := tokens
	refreshed.AccessToken = "late-refresh-access-token"
	if committed, err := oldProcess.CommitRefresh(ctx, stale.Generation, refreshed); err != nil || committed {
		t.Fatalf("stale CommitRefresh() = committed:%v err:%v, want CAS rejection", committed, err)
	}
	if committed, err := oldProcess.CommitAuth(ctx, stale.Generation, registration, tokens); err != nil || committed {
		t.Fatalf("stale CommitAuth() = committed:%v err:%v, want CAS rejection", committed, err)
	}

	newProcess := newPersistentStoreForTest(t, blob, lockDir)
	current, err := newProcess.Snapshot(ctx)
	if err != nil || current.HasSession || !current.HasRegistration || current.Registration != registration || current.Generation != stale.Generation+1 {
		t.Fatalf("post-logout snapshot = %#v, err=%v", current, err)
	}
}
