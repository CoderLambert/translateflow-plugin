package siwc

import (
	"context"
	"sync"
	"time"
)

// Registration is durable client identity. Logout must not erase these values:
// the next authorization needs the issued client ID and stable host ID, but no
// prior session token is sent as an id_token_hint after sign-out.
type Registration struct {
	ClientID string
	HostID   string
	Subject  string
	Email    string
}

// SessionTokens are the revocable, short-lived part of a registration.
type SessionTokens struct {
	IDToken      string
	AccessToken  string
	RefreshToken string
	Scopes       []string
	Expiry       time.Time
}

// Credential is a convenient value representation used at protocol boundaries
// and in tests. Stores keep its registration and session fields separately.
type Credential struct {
	ClientID     string
	HostID       string
	Subject      string
	Email        string
	IDToken      string
	AccessToken  string
	RefreshToken string
	Scopes       []string
	Expiry       time.Time
}

type CredentialSnapshot struct {
	Registration    Registration
	HasRegistration bool
	Tokens          SessionTokens
	HasSession      bool
	Generation      uint64
}

// CredentialStore exposes generation-checked commits so an authorization or
// refresh begun before logout cannot repopulate the cleared session.
type CredentialStore interface {
	Snapshot(context.Context) (CredentialSnapshot, error)
	CommitAuth(context.Context, uint64, Registration, SessionTokens) (bool, error)
	CommitRefresh(context.Context, uint64, SessionTokens) (bool, error)
	InvalidateSession(context.Context) (Credential, error)
	AcquireRefreshLock(context.Context) (func(), error)
}

// MemoryStore keeps the registration and session separately for the lifetime
// of the process. The native host uses PersistentStore; this remains a simple
// adapter for isolated tests and callers that explicitly want in-memory state.
type MemoryStore struct {
	mu           sync.Mutex
	registration *Registration
	session      *SessionTokens
	generation   uint64
	refreshLock  chan struct{}
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{refreshLock: make(chan struct{}, 1)}
}

func (s *MemoryStore) StorageName() string { return "process-memory" }

func (s *MemoryStore) AcquireRefreshLock(ctx context.Context) (func(), error) {
	select {
	case s.refreshLock <- struct{}{}:
		return func() { <-s.refreshLock }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *MemoryStore) Snapshot(ctx context.Context) (CredentialSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return CredentialSnapshot{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked(), nil
}

func (s *MemoryStore) CommitAuth(ctx context.Context, expected uint64, registration Registration, tokens SessionTokens) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.generation != expected {
		return false, nil
	}
	regCopy := registration
	tokensCopy := cloneTokens(tokens)
	s.registration = &regCopy
	s.session = &tokensCopy
	s.generation++
	return true, nil
}

func (s *MemoryStore) CommitRefresh(ctx context.Context, expected uint64, tokens SessionTokens) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.generation != expected || s.registration == nil || s.session == nil {
		return false, nil
	}
	tokensCopy := cloneTokens(tokens)
	s.session = &tokensCopy
	s.generation++
	return true, nil
}

// InvalidateSession atomically returns the revoked token snapshot, clears only
// the session, and advances the generation while retaining client identity.
func (s *MemoryStore) InvalidateSession(ctx context.Context) (Credential, error) {
	if err := ctx.Err(); err != nil {
		return Credential{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	credential := s.credentialLocked()
	s.session = nil
	s.generation++
	return credential, nil
}

// Load and Save are convenience methods for tests and local fixtures. Load's
// bool indicates whether session tokens exist; registration may be present
// even when it returns false after logout.
func (s *MemoryStore) Load(ctx context.Context) (Credential, bool, error) {
	snapshot, err := s.Snapshot(ctx)
	if err != nil {
		return Credential{}, false, err
	}
	return snapshot.credential(), snapshot.HasSession, nil
}

func (s *MemoryStore) Save(ctx context.Context, credential Credential) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	registration := Registration{
		ClientID: credential.ClientID,
		HostID:   credential.HostID,
		Subject:  credential.Subject,
		Email:    credential.Email,
	}
	tokens := SessionTokens{
		IDToken:      credential.IDToken,
		AccessToken:  credential.AccessToken,
		RefreshToken: credential.RefreshToken,
		Scopes:       append([]string(nil), credential.Scopes...),
		Expiry:       credential.Expiry,
	}
	s.registration = &registration
	s.session = &tokens
	s.generation++
	return nil
}

// Clear is logout semantics: clear tokens but retain the issued registration.
func (s *MemoryStore) Clear(ctx context.Context) error {
	_, err := s.InvalidateSession(ctx)
	return err
}

func (s *MemoryStore) snapshotLocked() CredentialSnapshot {
	snapshot := CredentialSnapshot{Generation: s.generation}
	if s.registration != nil {
		snapshot.Registration = *s.registration
		snapshot.HasRegistration = true
	}
	if s.session != nil {
		snapshot.Tokens = cloneTokens(*s.session)
		snapshot.HasSession = true
	}
	return snapshot
}

func (s *MemoryStore) credentialLocked() Credential {
	var value Credential
	if s.registration != nil {
		value.ClientID = s.registration.ClientID
		value.HostID = s.registration.HostID
		value.Subject = s.registration.Subject
		value.Email = s.registration.Email
	}
	if s.session != nil {
		value.IDToken = s.session.IDToken
		value.AccessToken = s.session.AccessToken
		value.RefreshToken = s.session.RefreshToken
		value.Scopes = append([]string(nil), s.session.Scopes...)
		value.Expiry = s.session.Expiry
	}
	return value
}

func (snapshot CredentialSnapshot) credential() Credential {
	value := Credential{}
	if snapshot.HasRegistration {
		value.ClientID = snapshot.Registration.ClientID
		value.HostID = snapshot.Registration.HostID
		value.Subject = snapshot.Registration.Subject
		value.Email = snapshot.Registration.Email
	}
	if snapshot.HasSession {
		value.IDToken = snapshot.Tokens.IDToken
		value.AccessToken = snapshot.Tokens.AccessToken
		value.RefreshToken = snapshot.Tokens.RefreshToken
		value.Scopes = append([]string(nil), snapshot.Tokens.Scopes...)
		value.Expiry = snapshot.Tokens.Expiry
	}
	return value
}

func cloneTokens(value SessionTokens) SessionTokens {
	value.Scopes = append([]string(nil), value.Scopes...)
	return value
}
