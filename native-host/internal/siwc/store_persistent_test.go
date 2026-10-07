package siwc

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type fakeSecureBlob struct {
	mu       sync.Mutex
	value    []byte
	readErr  error
	writeErr error
}

type observedRefreshStore struct {
	CredentialStore
	entered chan<- struct{}
}

func (s *observedRefreshStore) AcquireRefreshLock(ctx context.Context) (func(), error) {
	s.entered <- struct{}{}
	return s.CredentialStore.AcquireRefreshLock(ctx)
}

func (b *fakeSecureBlob) Read() ([]byte, error) {
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

func (b *fakeSecureBlob) Write(value []byte) error {
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

func TestPersistentStoreRestoresSessionAfterHostRestart(t *testing.T) {
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

	// Reconstructing the host store over the same OS backend and lock directory
	// models a process restart; no prior Go object remains involved.
	restarted := newPersistentStoreForTest(t, blob, lockDir)
	snapshot, err := restarted.Snapshot(ctx)
	if err != nil || !snapshot.HasRegistration || !snapshot.HasSession {
		t.Fatalf("restarted Snapshot() = %#v, err=%v", snapshot, err)
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

func TestPersistentStoreLogoutRejectsWritesFromOlderHostProcess(t *testing.T) {
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
