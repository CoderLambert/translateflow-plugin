package siwc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrAccountNotFound = errors.New("saved ChatGPT account not found")

// Registration is durable client identity. Logout must not erase these values.
type Registration struct {
	AccountID string
	Label     string
	ClientID  string
	HostID    string
	Subject   string
	Email     string
}

type SessionTokens struct {
	IDToken      string
	AccessToken  string
	RefreshToken string
	Scopes       []string
	Expiry       time.Time
}

type Credential struct {
	AccountID    string
	Label        string
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

type AccountSummary struct {
	ID        string
	Label     string
	Email     string
	Connected bool
}

// CredentialStore keeps multiple registrations while presenting the selected
// account through Snapshot. Generation-checked commits fence stale work across
// logout and account switches.
type CredentialStore interface {
	Snapshot(context.Context) (CredentialSnapshot, error)
	Accounts(context.Context) ([]AccountSummary, string, error)
	HostID(context.Context) (string, bool, error)
	SelectAccount(context.Context, string) error
	CommitAuth(context.Context, uint64, Registration, SessionTokens) (bool, error)
	CommitRefresh(context.Context, uint64, SessionTokens) (bool, error)
	InvalidateSession(context.Context) (Credential, error)
	AcquireRefreshLock(context.Context) (func(), error)
}

type memoryAccount struct {
	registration Registration
	session      *SessionTokens
}

type MemoryStore struct {
	mu          sync.Mutex
	accounts    map[string]*memoryAccount
	active      string
	generation  uint64
	refreshLock chan struct{}
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{accounts: make(map[string]*memoryAccount), refreshLock: make(chan struct{}, 1)}
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

func (s *MemoryStore) Accounts(ctx context.Context) ([]AccountSummary, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]AccountSummary, 0, len(s.accounts))
	for _, account := range s.accounts {
		if account == nil {
			continue
		}
		result = append(result, AccountSummary{ID: account.registration.AccountID, Label: account.registration.Label,
			Email: account.registration.Email, Connected: account.session != nil})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Label != result[j].Label {
			return result[i].Label < result[j].Label
		}
		return result[i].ID < result[j].ID
	})
	return result, s.active, nil
}

func (s *MemoryStore) HostID(ctx context.Context) (string, bool, error) {
	if err := ctx.Err(); err != nil {
		return "", false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if account := s.accounts[s.active]; account != nil {
		return account.registration.HostID, true, nil
	}
	keys := sortedAccountKeys(s.accounts)
	if len(keys) == 0 {
		return "", false, nil
	}
	return s.accounts[keys[0]].registration.HostID, true, nil
}

func (s *MemoryStore) SelectAccount(ctx context.Context, accountID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accounts[accountID] == nil {
		return ErrAccountNotFound
	}
	if s.active != accountID {
		s.active = accountID
		s.generation++
	}
	return nil
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
	registration = normalizeRegistration(registration)
	if registration.AccountID == "" {
		return false, ErrCredentialRecordInvalid
	}
	for id, account := range s.accounts {
		if id != registration.AccountID && account != nil && account.registration.ClientID == registration.ClientID {
			return false, ErrCredentialRecordInvalid
		}
	}
	regCopy := registration
	tokensCopy := cloneTokens(tokens)
	s.accounts[registration.AccountID] = &memoryAccount{registration: regCopy, session: &tokensCopy}
	s.active = registration.AccountID
	s.generation++
	return true, nil
}

func (s *MemoryStore) CommitRefresh(ctx context.Context, expected uint64, tokens SessionTokens) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	account := s.accounts[s.active]
	if s.generation != expected || account == nil || account.session == nil {
		return false, nil
	}
	tokensCopy := cloneTokens(tokens)
	account.session = &tokensCopy
	s.generation++
	return true, nil
}

func (s *MemoryStore) InvalidateSession(ctx context.Context) (Credential, error) {
	if err := ctx.Err(); err != nil {
		return Credential{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	credential := s.snapshotLocked().credential()
	if account := s.accounts[s.active]; account != nil {
		account.session = nil
	}
	s.generation++
	return credential, nil
}

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
	registration := normalizeRegistration(Registration{AccountID: credential.AccountID, Label: credential.Label,
		ClientID: credential.ClientID, HostID: credential.HostID, Subject: credential.Subject, Email: credential.Email})
	tokens := SessionTokens{IDToken: credential.IDToken, AccessToken: credential.AccessToken,
		RefreshToken: credential.RefreshToken, Scopes: append([]string(nil), credential.Scopes...), Expiry: credential.Expiry}
	s.accounts[registration.AccountID] = &memoryAccount{registration: registration, session: &tokens}
	s.active = registration.AccountID
	s.generation++
	return nil
}

func (s *MemoryStore) Clear(ctx context.Context) error {
	_, err := s.InvalidateSession(ctx)
	return err
}

func (s *MemoryStore) snapshotLocked() CredentialSnapshot {
	snapshot := CredentialSnapshot{Generation: s.generation}
	account := s.accounts[s.active]
	if account == nil {
		return snapshot
	}
	snapshot.Registration = account.registration
	snapshot.HasRegistration = true
	if account.session != nil {
		snapshot.Tokens = cloneTokens(*account.session)
		snapshot.HasSession = true
	}
	return snapshot
}

func (snapshot CredentialSnapshot) credential() Credential {
	value := Credential{}
	if snapshot.HasRegistration {
		value.AccountID = snapshot.Registration.AccountID
		value.Label = snapshot.Registration.Label
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

func normalizeRegistration(value Registration) Registration {
	if value.AccountID == "" && value.ClientID != "" {
		digest := sha256.Sum256([]byte(value.ClientID + "\x00" + value.Subject))
		value.AccountID = "account-" + hex.EncodeToString(digest[:12])
	}
	if value.Label == "" && value.AccountID != "" {
		suffix := value.AccountID
		if len(suffix) > 8 {
			suffix = suffix[len(suffix)-8:]
		}
		if strings.TrimSpace(value.Email) != "" {
			value.Label = strings.TrimSpace(value.Email) + " · " + suffix
		} else {
			value.Label = "ChatGPT account · " + suffix
		}
	}
	return value
}

func sortedAccountKeys(accounts map[string]*memoryAccount) []string {
	keys := make([]string, 0, len(accounts))
	for key := range accounts {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func cloneTokens(value SessionTokens) SessionTokens {
	value.Scopes = append([]string(nil), value.Scopes...)
	return value
}
