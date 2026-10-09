package siwc

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/gofrs/flock"
)

const (
	legacyCredentialVersion  = 1
	credentialRecordVersion  = 2
	credentialPointerVersion = 1
	maxCredentialAccounts    = 20
	maxCredentialRecord      = 1 << 20
	maxCredentialPointer     = 4096
	lockRetryDelay           = 25 * time.Millisecond
	credentialPointerName    = "credential-pointer.json"
)

var (
	ErrSecureBlobNotFound      = errors.New("secure credential item not found")
	ErrSecureBlobCorrupt       = errors.New("secure credential item is corrupt")
	ErrSecureStoreLocked       = errors.New("system secure store is locked")
	ErrSecureStoreUnavailable  = errors.New("system secure store is unavailable")
	ErrCredentialRecordInvalid = errors.New("stored credential record is invalid")
)

// SecureBlobStore stores immutable, opaque versions in an operating-system
// protected credential facility. A cancelled Write may still be applied by a
// remote service; PersistentStore never makes that version readable unless a
// separate local pointer is atomically committed.
type SecureBlobStore interface {
	Read(context.Context, string) ([]byte, error)
	Write(context.Context, string, []byte) error
	Delete(context.Context, string) error
}

type credentialRecord struct {
	Version         int                          `json:"version"`
	Generation      uint64                       `json:"generation"`
	ActiveAccountID string                       `json:"active_account_id,omitempty"`
	Accounts        map[string]credentialAccount `json:"accounts,omitempty"`
	// Version 1 compatibility. These fields are migrated in memory and are
	// omitted from every new write.
	Registration *Registration  `json:"registration,omitempty"`
	Session      *SessionTokens `json:"session,omitempty"`
}

type credentialAccount struct {
	Registration Registration   `json:"registration"`
	Session      *SessionTokens `json:"session,omitempty"`
}

// credentialPointer is deliberately non-secret. Its generation fences out
// older session records, while BlobID selects exactly one confirmed blob. A
// remote write that completes after its caller timed out can never replace it.
type credentialPointer struct {
	Version    int    `json:"version"`
	Generation uint64 `json:"generation"`
	BlobID     string `json:"blob_id,omitempty"`
}

// PersistentStore adds process-safe state transitions and a separate
// interprocess refresh lock around an OS-protected credential blob.
type PersistentStore struct {
	blob        SecureBlobStore
	lockDir     string
	pointerPath string
}

func NewPersistentStore(blob SecureBlobStore, lockDir string) (*PersistentStore, error) {
	if blob == nil {
		return nil, errors.New("a secure blob store is required")
	}
	if lockDir == "" {
		return nil, errors.New("a credential lock directory is required")
	}
	lockDir = filepath.Clean(lockDir)
	if err := os.MkdirAll(lockDir, 0o700); err != nil {
		return nil, fmt.Errorf("%w: could not create the credential lock directory", ErrSecureStoreUnavailable)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(lockDir, 0o700); err != nil {
			return nil, fmt.Errorf("%w: could not protect the credential lock directory", ErrSecureStoreUnavailable)
		}
	}
	return &PersistentStore{
		blob:        blob,
		lockDir:     lockDir,
		pointerPath: filepath.Join(lockDir, credentialPointerName),
	}, nil
}

func (*PersistentStore) StorageName() string { return "system-secure" }

func (s *PersistentStore) Snapshot(ctx context.Context) (CredentialSnapshot, error) {
	var snapshot CredentialSnapshot
	err := s.withStateLock(ctx, func() error {
		record, err := s.readRecord(ctx)
		if err != nil {
			return err
		}
		snapshot = record.snapshot()
		return nil
	})
	return snapshot, err
}

func (s *PersistentStore) Accounts(ctx context.Context) ([]AccountSummary, string, error) {
	var summaries []AccountSummary
	var active string
	err := s.withStateLock(ctx, func() error {
		record, err := s.readRecord(ctx)
		if err != nil {
			return err
		}
		active = record.ActiveAccountID
		ids := make([]string, 0, len(record.Accounts))
		for id := range record.Accounts {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool {
			left, right := record.Accounts[ids[i]].Registration, record.Accounts[ids[j]].Registration
			if left.Label != right.Label {
				return left.Label < right.Label
			}
			return ids[i] < ids[j]
		})
		summaries = make([]AccountSummary, 0, len(ids))
		for _, id := range ids {
			account := record.Accounts[id]
			summaries = append(summaries, AccountSummary{ID: id, Label: account.Registration.Label,
				Email: account.Registration.Email, Connected: account.Session != nil})
		}
		return nil
	})
	return summaries, active, err
}

func (s *PersistentStore) HostID(ctx context.Context) (string, bool, error) {
	var hostID string
	err := s.withStateLock(ctx, func() error {
		record, err := s.readRecord(ctx)
		if err != nil {
			return err
		}
		if account, ok := record.Accounts[record.ActiveAccountID]; ok {
			hostID = account.Registration.HostID
			return nil
		}
		ids := make([]string, 0, len(record.Accounts))
		for id := range record.Accounts {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		if len(ids) > 0 {
			hostID = record.Accounts[ids[0]].Registration.HostID
		}
		return nil
	})
	return hostID, hostID != "", err
}

func (s *PersistentStore) SelectAccount(ctx context.Context, accountID string) error {
	return s.withStateLock(ctx, func() error {
		record, err := s.readRecord(ctx)
		if err != nil {
			return err
		}
		if _, ok := record.Accounts[accountID]; !ok {
			return ErrAccountNotFound
		}
		if record.ActiveAccountID == accountID {
			return nil
		}
		if record.Generation == math.MaxUint64 {
			return ErrCredentialRecordInvalid
		}
		record.Generation++
		record.ActiveAccountID = accountID
		return s.writeRecord(ctx, record)
	})
}

func (s *PersistentStore) CommitAuth(ctx context.Context, expected uint64, registration Registration, tokens SessionTokens) (bool, error) {
	committed := false
	err := s.withStateLock(ctx, func() error {
		record, err := s.readRecord(ctx)
		if err != nil {
			return err
		}
		if record.Generation != expected {
			return nil
		}
		if record.Generation == math.MaxUint64 {
			return ErrCredentialRecordInvalid
		}
		registration = normalizeRegistration(registration)
		if registration.AccountID == "" {
			return ErrCredentialRecordInvalid
		}
		if _, exists := record.Accounts[registration.AccountID]; !exists && len(record.Accounts) >= maxCredentialAccounts {
			return ErrCredentialRecordInvalid
		}
		for id, account := range record.Accounts {
			if id != registration.AccountID && account.Registration.ClientID == registration.ClientID {
				return ErrCredentialRecordInvalid
			}
		}
		regCopy := registration
		tokenCopy := cloneTokens(tokens)
		record.Version = credentialRecordVersion
		record.Generation++
		if record.Accounts == nil {
			record.Accounts = make(map[string]credentialAccount)
		}
		record.Accounts[registration.AccountID] = credentialAccount{Registration: regCopy, Session: &tokenCopy}
		record.ActiveAccountID = registration.AccountID
		if err := s.writeRecord(ctx, record); err != nil {
			return err
		}
		committed = true
		return nil
	})
	return committed, err
}

func (s *PersistentStore) CommitRefresh(ctx context.Context, expected uint64, tokens SessionTokens) (bool, error) {
	committed := false
	err := s.withStateLock(ctx, func() error {
		record, err := s.readRecord(ctx)
		if err != nil {
			return err
		}
		account, ok := record.Accounts[record.ActiveAccountID]
		if record.Generation != expected || !ok || account.Session == nil {
			return nil
		}
		if record.Generation == math.MaxUint64 {
			return ErrCredentialRecordInvalid
		}
		tokenCopy := cloneTokens(tokens)
		record.Version = credentialRecordVersion
		record.Generation++
		account.Session = &tokenCopy
		record.Accounts[record.ActiveAccountID] = account
		if err := s.writeRecord(ctx, record); err != nil {
			return err
		}
		committed = true
		return nil
	})
	return committed, err
}

func (s *PersistentStore) InvalidateSession(ctx context.Context) (Credential, error) {
	var credential Credential
	err := s.withStateLock(ctx, func() error {
		pointer, err := s.readPointer()
		if err != nil {
			return err
		}
		if pointer.Generation == math.MaxUint64 {
			return ErrCredentialRecordInvalid
		}
		oldGeneration := pointer.Generation
		pointer.Generation = oldGeneration + 1
		// Persist logout's fence before contacting the secure store. No delayed
		// remote write can move this pointer or make an older generation valid.
		if err := s.writePointer(ctx, pointer); err != nil {
			return err
		}
		if pointer.BlobID == "" {
			return nil
		}
		// Reading the old record is only for best-effort token revocation. The
		// durable epoch already makes local logout effective if this read fails.
		record, err := s.readBlobRecord(ctx, pointer.BlobID)
		if err != nil || record.Generation > oldGeneration {
			return nil
		}
		if record.Generation < oldGeneration {
			record.clearActiveSession()
		}
		credential = record.snapshot().credential()
		return nil
	})
	return credential, err
}

func (s *PersistentStore) AcquireRefreshLock(ctx context.Context) (func(), error) {
	return acquireCredentialLock(ctx, filepath.Join(s.lockDir, "refresh.lock"))
}

func (s *PersistentStore) withStateLock(ctx context.Context, action func() error) error {
	unlock, err := acquireCredentialLock(ctx, filepath.Join(s.lockDir, "state.lock"))
	if err != nil {
		return err
	}
	defer unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	return action()
}

func acquireCredentialLock(ctx context.Context, path string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	lock := flock.New(path, flock.SetPermissions(0o600))
	locked, err := lock.TryLockContext(ctx, lockRetryDelay)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w: could not acquire process lock", ErrSecureStoreUnavailable)
	}
	if !locked {
		return nil, fmt.Errorf("%w: process lock was not acquired", ErrSecureStoreUnavailable)
	}
	return func() { _ = lock.Unlock() }, nil
}

func (s *PersistentStore) readRecord(ctx context.Context) (credentialRecord, error) {
	if err := ctx.Err(); err != nil {
		return credentialRecord{}, err
	}
	pointer, err := s.readPointer()
	if err != nil {
		return credentialRecord{}, err
	}
	if pointer.BlobID == "" {
		return credentialRecord{Version: credentialRecordVersion, Generation: pointer.Generation}, nil
	}
	record, err := s.readBlobRecord(ctx, pointer.BlobID)
	if ctx.Err() != nil {
		return credentialRecord{}, ctx.Err()
	}
	if err != nil {
		return credentialRecord{}, err
	}
	if record.Generation > pointer.Generation {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	if record.Generation < pointer.Generation {
		// Logout durably advances the local epoch before any best-effort secure
		// store mutation. Preserve reauthorization data but invalidate tokens.
		record.Generation = pointer.Generation
		record.clearActiveSession()
	}
	return record, nil
}

func (s *PersistentStore) readBlobRecord(ctx context.Context, blobID string) (credentialRecord, error) {
	data, err := s.blob.Read(ctx, blobID)
	if ctx.Err() != nil {
		return credentialRecord{}, ctx.Err()
	}
	if errors.Is(err, ErrSecureBlobNotFound) {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	if errors.Is(err, ErrSecureBlobCorrupt) {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	if errors.Is(err, ErrSecureStoreLocked) {
		return credentialRecord{}, ErrSecureStoreLocked
	}
	if err != nil {
		return credentialRecord{}, fmt.Errorf("%w: secure credential read failed", ErrSecureStoreUnavailable)
	}
	if len(data) == 0 || len(data) > maxCredentialRecord {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var record credentialRecord
	if err := decoder.Decode(&record); err != nil {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	if err := record.normalizeAndValidate(); err != nil {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	return record, nil
}

func (s *PersistentStore) writeRecord(ctx context.Context, record credentialRecord) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	record.Version = credentialRecordVersion
	record.Registration = nil
	record.Session = nil
	if err := record.normalizeAndValidate(); err != nil {
		return ErrCredentialRecordInvalid
	}
	data, err := json.Marshal(record)
	if err != nil || len(data) > maxCredentialRecord {
		return ErrCredentialRecordInvalid
	}
	pointer, err := s.readPointer()
	if err != nil {
		return err
	}
	if record.Generation < pointer.Generation || record.Generation > pointer.Generation+1 {
		return ErrCredentialRecordInvalid
	}
	versionID, err := newCredentialBlobID()
	if err != nil {
		return ErrSecureStoreUnavailable
	}
	if err := s.blob.Write(ctx, versionID, data); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if errors.Is(err, ErrSecureStoreLocked) {
			return ErrSecureStoreLocked
		}
		return fmt.Errorf("%w: secure credential write failed", ErrSecureStoreUnavailable)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	previousID := pointer.BlobID
	pointer.Version = credentialPointerVersion
	pointer.Generation = record.Generation
	pointer.BlobID = versionID
	if err := s.writePointer(ctx, pointer); err != nil {
		return err
	}
	if previousID != "" && previousID != versionID {
		// Old versions are no longer reachable through the pointer. Delete is
		// best effort; failure cannot reactivate them.
		_ = s.blob.Delete(ctx, previousID)
	}
	return nil
}

func (s *PersistentStore) readPointer() (credentialPointer, error) {
	data, err := os.ReadFile(s.pointerPath)
	if errors.Is(err, os.ErrNotExist) {
		return credentialPointer{Version: credentialPointerVersion}, nil
	}
	if err != nil {
		return credentialPointer{}, fmt.Errorf("%w: could not read credential pointer", ErrSecureStoreUnavailable)
	}
	if len(data) == 0 || len(data) > maxCredentialPointer {
		return credentialPointer{}, ErrCredentialRecordInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var pointer credentialPointer
	if err := decoder.Decode(&pointer); err != nil {
		return credentialPointer{}, ErrCredentialRecordInvalid
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return credentialPointer{}, ErrCredentialRecordInvalid
	}
	if pointer.Version != credentialPointerVersion || pointer.BlobID != "" && !validCredentialBlobID(pointer.BlobID) {
		return credentialPointer{}, ErrCredentialRecordInvalid
	}
	return pointer, nil
}

func (s *PersistentStore) writePointer(ctx context.Context, pointer credentialPointer) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	pointer.Version = credentialPointerVersion
	if pointer.BlobID != "" && !validCredentialBlobID(pointer.BlobID) {
		return ErrCredentialRecordInvalid
	}
	data, err := json.Marshal(pointer)
	if err != nil || len(data) > maxCredentialPointer {
		return ErrCredentialRecordInvalid
	}
	if err := writePrivateAtomicFile(ctx, s.pointerPath, data); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%w: could not commit credential pointer", ErrSecureStoreUnavailable)
	}
	return nil
}

func newCredentialBlobID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

func validCredentialBlobID(value string) bool {
	if len(value) != 32 || strings.ToLower(value) != value {
		return false
	}
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			if ch < 'a' || ch > 'f' {
				return false
			}
		}
	}
	return true
}

func writePrivateAtomicFile(ctx context.Context, path string, data []byte) error {
	return writePrivateAtomicFileWithSync(ctx, path, data, syncCredentialDirectory)
}

func writePrivateAtomicFileWithSync(ctx context.Context, path string, data []byte, syncDirectory func(string) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".credential-pointer-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := replaceCredentialFile(tempPath, path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func syncCredentialDirectoryWith(path string, openDirectory func(string) (*os.File, error)) error {
	directory, err := openDirectory(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (record credentialRecord) snapshot() CredentialSnapshot {
	snapshot := CredentialSnapshot{Generation: record.Generation}
	account, ok := record.Accounts[record.ActiveAccountID]
	if ok {
		snapshot.Registration = account.Registration
		snapshot.HasRegistration = true
	}
	if ok && account.Session != nil {
		snapshot.Tokens = cloneTokens(*account.Session)
		snapshot.HasSession = true
	}
	return snapshot
}

func (record *credentialRecord) normalizeAndValidate() error {
	if record.Version == legacyCredentialVersion {
		if record.Session != nil && record.Registration == nil {
			return ErrCredentialRecordInvalid
		}
		record.Accounts = make(map[string]credentialAccount)
		if record.Registration != nil {
			registration := normalizeRegistration(*record.Registration)
			if registration.AccountID == "" {
				return ErrCredentialRecordInvalid
			}
			record.Accounts[registration.AccountID] = credentialAccount{Registration: registration, Session: record.Session}
			record.ActiveAccountID = registration.AccountID
		}
		record.Registration = nil
		record.Session = nil
		record.Version = credentialRecordVersion
	}
	if record.Version != credentialRecordVersion || len(record.Accounts) > maxCredentialAccounts {
		return ErrCredentialRecordInvalid
	}
	if record.Accounts == nil {
		record.Accounts = make(map[string]credentialAccount)
	}
	if len(record.Accounts) == 0 {
		if record.ActiveAccountID != "" {
			return ErrCredentialRecordInvalid
		}
		return nil
	}
	if _, ok := record.Accounts[record.ActiveAccountID]; !ok {
		return ErrCredentialRecordInvalid
	}
	for id, account := range record.Accounts {
		registration := normalizeRegistration(account.Registration)
		if id == "" || len(id) > 128 || registration.AccountID != id || registration.ClientID == "" ||
			registration.HostID == "" || registration.Subject == "" || registration.Label == "" || len(registration.Label) > 256 {
			return ErrCredentialRecordInvalid
		}
		if account.Session != nil && account.Session.AccessToken == "" {
			return ErrCredentialRecordInvalid
		}
		account.Registration = registration
		record.Accounts[id] = account
	}
	return nil
}

func (record *credentialRecord) clearActiveSession() {
	account, ok := record.Accounts[record.ActiveAccountID]
	if !ok {
		return
	}
	account.Session = nil
	record.Accounts[record.ActiveAccountID] = account
}

type unavailableCredentialStore struct{}

func NewUnavailableCredentialStore() CredentialStore { return unavailableCredentialStore{} }

func (unavailableCredentialStore) StorageName() string { return "system-secure" }
func (unavailableCredentialStore) Snapshot(context.Context) (CredentialSnapshot, error) {
	return CredentialSnapshot{}, ErrSecureStoreUnavailable
}
func (unavailableCredentialStore) Accounts(context.Context) ([]AccountSummary, string, error) {
	return nil, "", ErrSecureStoreUnavailable
}
func (unavailableCredentialStore) HostID(context.Context) (string, bool, error) {
	return "", false, ErrSecureStoreUnavailable
}
func (unavailableCredentialStore) SelectAccount(context.Context, string) error {
	return ErrSecureStoreUnavailable
}
func (unavailableCredentialStore) CommitAuth(context.Context, uint64, Registration, SessionTokens) (bool, error) {
	return false, ErrSecureStoreUnavailable
}
func (unavailableCredentialStore) CommitRefresh(context.Context, uint64, SessionTokens) (bool, error) {
	return false, ErrSecureStoreUnavailable
}
func (unavailableCredentialStore) InvalidateSession(context.Context) (Credential, error) {
	return Credential{}, ErrSecureStoreUnavailable
}
func (unavailableCredentialStore) AcquireRefreshLock(context.Context) (func(), error) {
	return nil, ErrSecureStoreUnavailable
}
