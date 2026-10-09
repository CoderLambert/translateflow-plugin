package siwc

import (
	"os"
	"path/filepath"
)

// NewSystemStore selects the current-user secure credential backend. Multiple
// Chrome Native Messaging connections may create overlapping host processes,
// so process coordination belongs to PersistentStore's short-lived state and
// refresh locks rather than a host-lifetime lock.
// It does not read or write credentials during setup.
func NewSystemStore() (CredentialStore, error) {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		return nil, ErrSecureStoreUnavailable
	}
	storeDir := filepath.Join(configDir, "CoderLambert", "TranslateFlow", "native-host")
	blob, err := newSystemSecureBlobStore(storeDir)
	if err != nil {
		return nil, ErrSecureStoreUnavailable
	}
	store, err := NewPersistentStore(blob, storeDir)
	if err != nil {
		return nil, ErrSecureStoreUnavailable
	}
	return store, nil
}
