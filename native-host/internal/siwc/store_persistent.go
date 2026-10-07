package siwc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/gofrs/flock"
)

const (
	credentialRecordVersion = 1
	maxCredentialRecord     = 1 << 20
	lockRetryDelay          = 25 * time.Millisecond
)

var (
	ErrSecureBlobNotFound      = errors.New("secure credential item not found")
	ErrSecureBlobCorrupt       = errors.New("secure credential item is corrupt")
	ErrSecureStoreUnavailable  = errors.New("system secure store is unavailable")
	ErrCredentialRecordInvalid = errors.New("stored credential record is invalid")
)

// SecureBlobStore stores one opaque byte string using an operating-system
// protected credential facility. Implementations must never persist plaintext.
type SecureBlobStore interface {
	Read() ([]byte, error)
	Write([]byte) error
}

type credentialRecord struct {
	Version      int            `json:"version"`
	Generation   uint64         `json:"generation"`
	Registration *Registration  `json:"registration,omitempty"`
	Session      *SessionTokens `json:"session,omitempty"`
}

// PersistentStore adds process-safe state transitions and a separate
// interprocess refresh lock around an OS-protected credential blob.
type PersistentStore struct {
	blob    SecureBlobStore
	lockDir string
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
	return &PersistentStore{blob: blob, lockDir: lockDir}, nil
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
		regCopy := registration
		tokenCopy := cloneTokens(tokens)
		record.Version = credentialRecordVersion
		record.Generation++
		record.Registration = &regCopy
		record.Session = &tokenCopy
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
		if record.Generation != expected || record.Registration == nil || record.Session == nil {
			return nil
		}
		if record.Generation == math.MaxUint64 {
			return ErrCredentialRecordInvalid
		}
		tokenCopy := cloneTokens(tokens)
		record.Version = credentialRecordVersion
		record.Generation++
		record.Session = &tokenCopy
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
		record, err := s.readRecord(ctx)
		if err != nil {
			return err
		}
		credential = record.snapshot().credential()
		if record.Generation == math.MaxUint64 {
			return ErrCredentialRecordInvalid
		}
		record.Version = credentialRecordVersion
		record.Generation++
		record.Session = nil
		return s.writeRecord(ctx, record)
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
	data, err := s.blob.Read()
	if errors.Is(err, ErrSecureBlobNotFound) {
		return credentialRecord{}, nil
	}
	if errors.Is(err, ErrSecureBlobCorrupt) {
		return credentialRecord{}, ErrCredentialRecordInvalid
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
	if record.Version != credentialRecordVersion || record.Session != nil && record.Registration == nil {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	if record.Registration != nil && (record.Registration.ClientID == "" || record.Registration.HostID == "" || record.Registration.Subject == "") {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	if record.Session != nil && record.Session.AccessToken == "" {
		return credentialRecord{}, ErrCredentialRecordInvalid
	}
	return record, nil
}

func (s *PersistentStore) writeRecord(ctx context.Context, record credentialRecord) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	record.Version = credentialRecordVersion
	data, err := json.Marshal(record)
	if err != nil || len(data) > maxCredentialRecord {
		return ErrCredentialRecordInvalid
	}
	if err := s.blob.Write(data); err != nil {
		return fmt.Errorf("%w: secure credential write failed", ErrSecureStoreUnavailable)
	}
	return nil
}

func (record credentialRecord) snapshot() CredentialSnapshot {
	snapshot := CredentialSnapshot{Generation: record.Generation}
	if record.Registration != nil {
		snapshot.Registration = *record.Registration
		snapshot.HasRegistration = true
	}
	if record.Session != nil {
		snapshot.Tokens = cloneTokens(*record.Session)
		snapshot.HasSession = true
	}
	return snapshot
}

type unavailableCredentialStore struct{}

func NewUnavailableCredentialStore() CredentialStore { return unavailableCredentialStore{} }

func (unavailableCredentialStore) StorageName() string { return "system-secure" }
func (unavailableCredentialStore) Snapshot(context.Context) (CredentialSnapshot, error) {
	return CredentialSnapshot{}, ErrSecureStoreUnavailable
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
