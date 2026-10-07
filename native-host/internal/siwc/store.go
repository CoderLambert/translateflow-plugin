package siwc

import (
	"context"
	"sync"
	"time"
)

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

type CredentialStore interface {
	Load(context.Context) (Credential, bool, error)
	Save(context.Context, Credential) error
	Clear(context.Context) error
}

// MemoryStore keeps credentials only for the lifetime of the host process.
// Platform-protected stores can implement CredentialStore in a later change.
type MemoryStore struct {
	mu         sync.Mutex
	credential *Credential
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{} }

func (s *MemoryStore) Load(ctx context.Context) (Credential, bool, error) {
	if err := ctx.Err(); err != nil {
		return Credential{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.credential == nil {
		return Credential{}, false, nil
	}
	return cloneCredential(*s.credential), true, nil
}

func (s *MemoryStore) Save(ctx context.Context, credential Credential) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	copy := cloneCredential(credential)
	s.credential = &copy
	return nil
}

func (s *MemoryStore) Clear(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.credential = nil
	return nil
}

func cloneCredential(value Credential) Credential {
	value.Scopes = append([]string(nil), value.Scopes...)
	return value
}
