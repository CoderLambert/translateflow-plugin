//go:build !linux && !windows

package siwc

import (
	"errors"
	"os"
	"path/filepath"
)

func newSystemSecureBlobStore(string) (SecureBlobStore, error) {
	return nil, errors.New("system credential storage is unsupported on this platform")
}

func replaceCredentialFile(tempPath, targetPath string) error {
	return os.Rename(tempPath, targetPath)
}

func syncCredentialDirectory(path string) error {
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
