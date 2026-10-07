//go:build windows

package siwc

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsDPAPIBlob struct{ path string }

func newSystemSecureBlobStore(storeDir string) (SecureBlobStore, error) {
	return windowsDPAPIBlob{path: filepath.Join(storeDir, "credentials.dpapi")}, nil
}

func (s windowsDPAPIBlob) Read() ([]byte, error) {
	file, err := os.Open(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrSecureBlobNotFound
	}
	if err != nil {
		return nil, ErrSecureStoreUnavailable
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxCredentialRecord {
		return nil, ErrSecureBlobCorrupt
	}
	ciphertext, err := io.ReadAll(io.LimitReader(file, maxCredentialRecord+1))
	if err != nil || len(ciphertext) == 0 || len(ciphertext) > maxCredentialRecord {
		return nil, ErrSecureBlobCorrupt
	}
	var input windows.DataBlob
	input.Size = uint32(len(ciphertext))
	input.Data = &ciphertext[0]
	var output windows.DataBlob
	err = windows.CryptUnprotectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
	runtime.KeepAlive(ciphertext)
	if err != nil || output.Data == nil || output.Size == 0 || output.Size > maxCredentialRecord {
		if output.Data != nil {
			_, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data)))
		}
		return nil, ErrSecureBlobCorrupt
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data)))
	return append([]byte(nil), unsafe.Slice(output.Data, int(output.Size))...), nil
}

func (s windowsDPAPIBlob) Write(plaintext []byte) error {
	if len(plaintext) == 0 || len(plaintext) > maxCredentialRecord {
		return ErrCredentialRecordInvalid
	}
	var input windows.DataBlob
	input.Size = uint32(len(plaintext))
	input.Data = &plaintext[0]
	var output windows.DataBlob
	err := windows.CryptProtectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
	runtime.KeepAlive(plaintext)
	if err != nil || output.Data == nil || output.Size == 0 || output.Size > maxCredentialRecord {
		if output.Data != nil {
			_, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data)))
		}
		return ErrSecureStoreUnavailable
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data)))
	ciphertext := unsafe.Slice(output.Data, int(output.Size))
	return writeProtectedBlob(s.path, ciphertext)
}

func writeProtectedBlob(path string, ciphertext []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".credentials-*.tmp")
	if err != nil {
		return ErrSecureStoreUnavailable
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return ErrSecureStoreUnavailable
	}
	if _, err := temp.Write(ciphertext); err != nil {
		_ = temp.Close()
		return ErrSecureStoreUnavailable
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return ErrSecureStoreUnavailable
	}
	if err := temp.Close(); err != nil {
		return ErrSecureStoreUnavailable
	}
	if err := os.Rename(tempPath, path); err != nil {
		return ErrSecureStoreUnavailable
	}
	return nil
}
