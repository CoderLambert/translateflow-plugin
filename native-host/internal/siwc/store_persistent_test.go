package siwc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type fakeSecureBlob struct {
	mu        sync.Mutex
	values    map[string][]byte
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

func (b *fakeSecureBlob) Read(ctx context.Context, versionID string) ([]byte, error) {
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
	value, ok := b.values[versionID]
	if !ok {
		return nil, ErrSecureBlobNotFound
	}
	return bytes.Clone(value), nil
}

func (b *fakeSecureBlob) Write(ctx context.Context, versionID string, value []byte) error {
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
	if b.values == nil {
		b.values = make(map[string][]byte)
	}
	b.values[versionID] = bytes.Clone(value)
	return nil
}

func (b *fakeSecureBlob) Delete(ctx context.Context, versionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.values, versionID)
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

type lateBlobWrite struct {
	versionID string
	data      []byte
}

// lateApplyingSecureBlob models a Secret Service call whose client-side wait
// is cancelled while the daemon continues an already accepted CreateItem.
// The simulated server commit intentionally ignores ctx.Done().
type lateApplyingSecureBlob struct {
	dir          string
	mu           sync.Mutex
	delayNext    bool
	started      chan lateBlobWrite
	allowRemote  chan struct{}
	remoteResult chan error
}

func newLateApplyingSecureBlob(t *testing.T, dir string) *lateApplyingSecureBlob {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	return &lateApplyingSecureBlob{
		dir:          dir,
		started:      make(chan lateBlobWrite, 1),
		allowRemote:  make(chan struct{}),
		remoteResult: make(chan error, 1),
	}
}

func (b *lateApplyingSecureBlob) Read(ctx context.Context, versionID string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(secureBlobFixturePath(b.dir, versionID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrSecureBlobNotFound
	}
	if err != nil {
		return nil, ErrSecureStoreUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return data, nil
}

func (b *lateApplyingSecureBlob) Write(ctx context.Context, versionID string, value []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	b.mu.Lock()
	delayed := b.delayNext
	b.delayNext = false
	b.mu.Unlock()
	if delayed {
		b.started <- lateBlobWrite{versionID: versionID, data: bytes.Clone(value)}
		go func() {
			<-b.allowRemote
			b.remoteResult <- os.WriteFile(secureBlobFixturePath(b.dir, versionID), value, 0o600)
		}()
		<-ctx.Done()
		return ctx.Err()
	}
	return os.WriteFile(secureBlobFixturePath(b.dir, versionID), value, 0o600)
}

func (b *lateApplyingSecureBlob) Delete(ctx context.Context, versionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	err := os.Remove(secureBlobFixturePath(b.dir, versionID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func secureBlobFixturePath(dir, versionID string) string {
	return filepath.Join(dir, "blob-"+versionID+".json")
}

func TestPersistentStoreSubprocessSnapshotHelper(t *testing.T) {
	storeDir := os.Getenv("TRANSLATEFLOW_PERSISTENT_SNAPSHOT_STORE_DIR")
	if storeDir == "" {
		return
	}
	blobDir := os.Getenv("TRANSLATEFLOW_PERSISTENT_SNAPSHOT_BLOB_DIR")
	blob := newLateApplyingSecureBlob(t, blobDir)
	store := newPersistentStoreForTest(t, blob, storeDir)
	snapshot, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fmt.Fprintln(os.Stdout, string(data))
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
	expectedRegistration := normalizeRegistration(registration)
	if snapshot.Registration != expectedRegistration || snapshot.Tokens.AccessToken != tokens.AccessToken ||
		snapshot.Tokens.RefreshToken != tokens.RefreshToken || snapshot.Generation != 1 {
		t.Fatalf("restored snapshot = %#v", snapshot)
	}
}

func TestPersistentStoreMigratesLegacyRecordWithoutClearingCredentials(t *testing.T) {
	ctx := context.Background()
	blob := &fakeSecureBlob{}
	store := newPersistentStoreForTest(t, blob, filepath.Join(t.TempDir(), "locks"))
	registration := Registration{ClientID: testIssuedClientID, HostID: "urn:uuid:legacy-host",
		Subject: "legacy-subject", Email: "legacy@example.invalid"}
	tokens := SessionTokens{AccessToken: "legacy-access", RefreshToken: "legacy-refresh",
		Scopes: []string{planUseScope}, Expiry: time.Now().Add(time.Hour)}
	legacy := credentialRecord{Version: legacyCredentialVersion, Generation: 7,
		Registration: &registration, Session: &tokens}
	data, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	const blobID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if err := blob.Write(ctx, blobID, data); err != nil {
		t.Fatal(err)
	}
	if err := store.writePointer(ctx, credentialPointer{Version: credentialPointerVersion, Generation: 7, BlobID: blobID}); err != nil {
		t.Fatal(err)
	}

	snapshot, err := store.Snapshot(ctx)
	if err != nil || !snapshot.HasRegistration || !snapshot.HasSession || snapshot.Generation != 7 ||
		snapshot.Tokens.RefreshToken != tokens.RefreshToken {
		t.Fatalf("migrated snapshot = %#v, err=%v", snapshot, err)
	}
	accounts, active, err := store.Accounts(ctx)
	if err != nil || len(accounts) != 1 || active != snapshot.Registration.AccountID ||
		accounts[0].Email != registration.Email || !accounts[0].Connected {
		t.Fatalf("migrated accounts = %#v active=%q err=%v", accounts, active, err)
	}
}

func TestPersistentStoreKeepsSessionsSeparateAcrossAccountSwitches(t *testing.T) {
	ctx := context.Background()
	store := newPersistentStoreForTest(t, &fakeSecureBlob{}, filepath.Join(t.TempDir(), "locks"))
	first := Registration{AccountID: "account-first", Label: "first@example.invalid · first",
		ClientID: "client-first", HostID: "urn:uuid:shared-host", Subject: "subject-first", Email: "first@example.invalid"}
	second := Registration{AccountID: "account-second", Label: "second@example.invalid · second",
		ClientID: "client-second", HostID: "urn:uuid:shared-host", Subject: "subject-second", Email: "second@example.invalid"}
	firstTokens := SessionTokens{AccessToken: "first-access", RefreshToken: "first-refresh", Scopes: []string{planUseScope}, Expiry: time.Now().Add(time.Hour)}
	secondTokens := SessionTokens{AccessToken: "second-access", RefreshToken: "second-refresh", Scopes: []string{planUseScope}, Expiry: time.Now().Add(time.Hour)}
	if committed, err := store.CommitAuth(ctx, 0, first, firstTokens); err != nil || !committed {
		t.Fatalf("first CommitAuth() = %v, %v", committed, err)
	}
	if committed, err := store.CommitAuth(ctx, 1, second, secondTokens); err != nil || !committed {
		t.Fatalf("second CommitAuth() = %v, %v", committed, err)
	}
	accounts, active, err := store.Accounts(ctx)
	if err != nil || len(accounts) != 2 || active != second.AccountID {
		t.Fatalf("accounts = %#v active=%q err=%v", accounts, active, err)
	}
	if err := store.SelectAccount(ctx, first.AccountID); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.Snapshot(ctx)
	if err != nil || snapshot.Registration.AccountID != first.AccountID || snapshot.Tokens.RefreshToken != firstTokens.RefreshToken {
		t.Fatalf("selected first snapshot = %#v err=%v", snapshot, err)
	}
	if _, err := store.InvalidateSession(ctx); err != nil {
		t.Fatal(err)
	}
	if err := store.SelectAccount(ctx, second.AccountID); err != nil {
		t.Fatal(err)
	}
	snapshot, err = store.Snapshot(ctx)
	if err != nil || !snapshot.HasSession || snapshot.Tokens.RefreshToken != secondTokens.RefreshToken {
		t.Fatalf("second session was not preserved: %#v err=%v", snapshot, err)
	}
}

func TestPersistentStoreSerializesOverlappingHostInstances(t *testing.T) {
	ctx := context.Background()
	blob := &fakeSecureBlob{}
	lockDir := filepath.Join(t.TempDir(), "shared-host-store")
	first := newPersistentStoreForTest(t, blob, lockDir)
	second := newPersistentStoreForTest(t, blob, lockDir)
	registration := Registration{
		ClientID: testIssuedClientID,
		HostID:   "urn:uuid:stable-host",
		Subject:  "overlapping-host-subject",
		Email:    "overlap@example.test",
	}
	initial := SessionTokens{
		IDToken:      "initial-id-token",
		AccessToken:  "initial-access-token",
		RefreshToken: "initial-refresh-token",
		Scopes:       []string{planUseScope},
		Expiry:       time.Now().Add(time.Hour),
	}
	if committed, err := first.CommitAuth(ctx, 0, registration, initial); err != nil || !committed {
		t.Fatalf("initial CommitAuth() = committed:%v err:%v", committed, err)
	}
	snapshot, err := first.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}

	type result struct {
		committed bool
		err       error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	for index, store := range []*PersistentStore{first, second} {
		index, store := index, store
		go func() {
			<-start
			next := initial
			next.AccessToken = fmt.Sprintf("overlap-access-%d", index)
			committed, err := store.CommitRefresh(ctx, snapshot.Generation, next)
			results <- result{committed: committed, err: err}
		}()
	}
	close(start)
	wins := 0
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.committed {
			wins++
		}
	}
	if wins != 1 {
		t.Fatalf("overlapping host commits = %d, want exactly one generation winner", wins)
	}
	final, err := second.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !final.HasSession || final.Generation != snapshot.Generation+1 ||
		(final.Tokens.AccessToken != "overlap-access-0" && final.Tokens.AccessToken != "overlap-access-1") {
		t.Fatalf("final overlapping host state = %#v", final)
	}
}

func TestPersistentStoreReturnsExplicitErrorsForUnavailableAndCorruptData(t *testing.T) {
	ctx := context.Background()
	blob := &fakeSecureBlob{readErr: errors.New("secret service is locked")}
	store := newPersistentStoreForTest(t, blob, filepath.Join(t.TempDir(), "locks"))
	const fixtureID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if err := store.writePointer(ctx, credentialPointer{Version: credentialPointerVersion, BlobID: fixtureID}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Snapshot(ctx); !errors.Is(err, ErrSecureStoreUnavailable) {
		t.Fatalf("locked secure store error = %v, want ErrSecureStoreUnavailable", err)
	}

	blob.mu.Lock()
	blob.readErr = nil
	blob.values = map[string][]byte{fixtureID: []byte(`{"version":1,"generation":0,"registration":{"client_id":"incomplete"}}`)}
	blob.mu.Unlock()
	if _, err := store.Snapshot(ctx); !errors.Is(err, ErrCredentialRecordInvalid) {
		t.Fatalf("corrupt credential record error = %v, want ErrCredentialRecordInvalid", err)
	}
	blob.mu.Lock()
	blob.values = nil
	blob.writeErr = errors.New("secret service is unavailable")
	blob.mu.Unlock()
	if err := store.writePointer(ctx, credentialPointer{Version: credentialPointerVersion}); err != nil {
		t.Fatal(err)
	}
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
	if err := blocked.writePointer(context.Background(), credentialPointer{Version: credentialPointerVersion, BlobID: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}); err != nil {
		t.Fatal(err)
	}
	blob.mu.Lock()
	blob.values = map[string][]byte{"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": []byte(`{"version":1,"generation":0}`)}
	blob.mu.Unlock()
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
	stored := len(blob.values)
	blob.mu.Unlock()
	if stored != 0 {
		t.Fatalf("cancelled Write changed the secure blob after it returned: %d version(s)", stored)
	}
}

func TestLateSecureWriteCannotReactivateSessionAfterLogoutAndRestart(t *testing.T) {
	root := t.TempDir()
	storeDir := filepath.Join(root, "store")
	blobDir := filepath.Join(root, "secret-service")
	blob := newLateApplyingSecureBlob(t, blobDir)
	store := newPersistentStoreForTest(t, blob, storeDir)
	registration := Registration{ClientID: testIssuedClientID, HostID: "urn:uuid:late-host", Subject: "offline-test-subject"}
	tokens := SessionTokens{AccessToken: "old-access-token", RefreshToken: "old-refresh-token", Scopes: []string{planUseScope}, Expiry: time.Now().Add(time.Hour)}
	if committed, err := store.CommitAuth(context.Background(), 0, registration, tokens); err != nil || !committed {
		t.Fatalf("initial CommitAuth() = committed:%v err=%v", committed, err)
	}
	initialPointer, err := store.readPointer()
	if err != nil || initialPointer.Generation != 1 || initialPointer.BlobID == "" {
		t.Fatalf("initial pointer = %#v err=%v", initialPointer, err)
	}
	initialVersionID := initialPointer.BlobID

	blob.mu.Lock()
	blob.delayNext = true
	blob.mu.Unlock()
	refreshed := tokens
	refreshed.AccessToken = "late-access-token"
	refreshed.RefreshToken = "late-refresh-token"
	refreshCtx, cancelRefresh := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancelRefresh()
	refreshDone := make(chan struct {
		committed bool
		err       error
	}, 1)
	go func() {
		committed, err := store.CommitRefresh(refreshCtx, initialPointer.Generation, refreshed)
		refreshDone <- struct {
			committed bool
			err       error
		}{committed: committed, err: err}
	}()
	var late lateBlobWrite
	select {
	case late = <-blob.started:
	case <-time.After(2 * time.Second):
		t.Fatal("the fake Secret Service did not accept the delayed versioned write")
	}
	select {
	case result := <-refreshDone:
		if result.committed || !errors.Is(result.err, context.DeadlineExceeded) {
			t.Fatalf("timed-out refresh = committed:%v err=%v", result.committed, result.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("client did not return when its Secret Service call timed out")
	}

	credential, err := store.InvalidateSession(context.Background())
	if err != nil || credential.RefreshToken != tokens.RefreshToken {
		t.Fatalf("logout invalidation = credential:%#v err=%v", credential, err)
	}
	logoutPointer, err := store.readPointer()
	if err != nil || logoutPointer.Generation != initialPointer.Generation+1 || logoutPointer.BlobID != initialVersionID {
		t.Fatalf("logout pointer = %#v err=%v; want durable epoch bump retaining the old blob only for registration", logoutPointer, err)
	}

	close(blob.allowRemote)
	select {
	case err := <-blob.remoteResult:
		if err != nil {
			t.Fatalf("simulated late CreateItem commit = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the fake Secret Service did not finish its post-timeout commit")
	}
	lateData, err := os.ReadFile(secureBlobFixturePath(blobDir, late.versionID))
	if err != nil {
		t.Fatalf("late item did not actually land after logout: %v", err)
	}
	var lateRecord credentialRecord
	if err := json.Unmarshal(lateData, &lateRecord); err != nil {
		t.Fatalf("decode delayed item: %v", err)
	}
	lateAccount := lateRecord.Accounts[lateRecord.ActiveAccountID]
	if lateRecord.Generation != logoutPointer.Generation ||
		lateAccount.Session == nil || lateAccount.Session.RefreshToken != "late-refresh-token" {
		t.Fatalf("delayed item = %#v; want the stale generation to have landed", lateRecord)
	}
	if late.versionID == logoutPointer.BlobID {
		t.Fatal("late version unexpectedly reused the active pointer ID")
	}

	command := exec.Command(os.Args[0], "-test.run=^TestPersistentStoreSubprocessSnapshotHelper$")
	command.Env = append(os.Environ(),
		"TRANSLATEFLOW_PERSISTENT_SNAPSHOT_STORE_DIR="+storeDir,
		"TRANSLATEFLOW_PERSISTENT_SNAPSHOT_BLOB_DIR="+blobDir,
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("restarted-store subprocess = %v, output=%s", err, output)
	}
	line, _, _ := bytes.Cut(output, []byte("\n"))
	var afterRestart CredentialSnapshot
	if err := json.Unmarshal(line, &afterRestart); err != nil {
		t.Fatalf("decode restarted-store snapshot from %q: %v", output, err)
	}
	if afterRestart.HasSession || afterRestart.Tokens.RefreshToken != "" || !afterRestart.HasRegistration ||
		afterRestart.Registration != normalizeRegistration(registration) || afterRestart.Generation != logoutPointer.Generation {
		t.Fatalf("late write resurrected a session after restart: %#v", afterRestart)
	}
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
	if err != nil || current.HasSession || !current.HasRegistration || current.Registration != normalizeRegistration(registration) || current.Generation != stale.Generation+1 {
		t.Fatalf("post-logout snapshot = %#v, err=%v", current, err)
	}
}
