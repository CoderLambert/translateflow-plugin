//go:build !linux && !windows

package siwc

import (
	"errors"
	"os"
)

func newSystemSecureBlobStore(string) (SecureBlobStore, error) {
	return nil, errors.New("system credential storage is unsupported on this platform")
}

func replaceCredentialFile(tempPath, targetPath string) error {
	return os.Rename(tempPath, targetPath)
}

func syncCredentialDirectory(path string) error {
	return syncCredentialDirectoryWith(path, os.Open)
}
