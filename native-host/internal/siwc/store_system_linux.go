//go:build linux

package siwc

import (
	"errors"

	"github.com/zalando/go-keyring"
)

const (
	linuxCredentialService = "CoderLambert.TranslateFlow.NativeHost"
	linuxCredentialUser    = "credentials-v1"
)

type linuxSecretServiceBlob struct{}

func newSystemSecureBlobStore(string) (SecureBlobStore, error) {
	return linuxSecretServiceBlob{}, nil
}

func (linuxSecretServiceBlob) Read() ([]byte, error) {
	value, err := keyring.Get(linuxCredentialService, linuxCredentialUser)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil, ErrSecureBlobNotFound
	}
	if err != nil {
		return nil, ErrSecureStoreUnavailable
	}
	return []byte(value), nil
}

func (linuxSecretServiceBlob) Write(value []byte) error {
	if err := keyring.Set(linuxCredentialService, linuxCredentialUser, string(value)); err != nil {
		return ErrSecureStoreUnavailable
	}
	return nil
}
