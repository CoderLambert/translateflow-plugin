package siwc

import (
	"os"
	"path/filepath"
)

// NewSystemStore selects the current-user secure credential backend and holds
// an exclusive process lock until the returned release function is called.
// It does not read or write credentials during setup.
func NewSystemStore() (CredentialStore, func(), error) {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		return nil, nil, ErrSecureStoreUnavailable
	}
	storeDir := filepath.Join(configDir, "CoderLambert", "TranslateFlow", "native-host")
	blob, err := newSystemSecureBlobStore(storeDir)
	if err != nil {
		return nil, nil, ErrSecureStoreUnavailable
	}
	store, err := NewPersistentStore(blob, storeDir)
	if err != nil {
		return nil, nil, ErrSecureStoreUnavailable
	}
	release, err := AcquireHostLock(storeDir)
	if err != nil {
		return nil, nil, err
	}
	return store, release, nil
}
