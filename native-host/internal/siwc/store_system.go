package siwc

import (
	"os"
	"path/filepath"
)

// NewSystemStore selects the current-user secure credential backend for the
// current platform. Backend setup failures remain visible as recoverable store
// errors through the protocol instead of triggering a plaintext fallback.
func NewSystemStore() CredentialStore {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		return NewUnavailableCredentialStore()
	}
	storeDir := filepath.Join(configDir, "CoderLambert", "TranslateFlow", "native-host")
	blob, err := newSystemSecureBlobStore(storeDir)
	if err != nil {
		return NewUnavailableCredentialStore()
	}
	store, err := NewPersistentStore(blob, storeDir)
	if err != nil {
		return NewUnavailableCredentialStore()
	}
	return store
}
