//go:build windows

package siwc

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsDPAPIBlob struct{ dir string }

func newSystemSecureBlobStore(storeDir string) (SecureBlobStore, error) {
	return windowsDPAPIBlob{dir: storeDir}, nil
}

func (s windowsDPAPIBlob) Read(ctx context.Context, versionID string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !validCredentialBlobID(versionID) {
		return nil, ErrCredentialRecordInvalid
	}
	file, err := os.Open(filepath.Join(s.dir, "credentials-"+versionID+".dpapi"))
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
	value := append([]byte(nil), unsafe.Slice(output.Data, int(output.Size))...)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return value, nil
}

func (s windowsDPAPIBlob) Write(ctx context.Context, versionID string, plaintext []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validCredentialBlobID(versionID) {
		return ErrCredentialRecordInvalid
	}
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
	return writeProtectedBlob(ctx, filepath.Join(s.dir, "credentials-"+versionID+".dpapi"), ciphertext)
}

func (s windowsDPAPIBlob) Delete(ctx context.Context, versionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validCredentialBlobID(versionID) {
		return ErrCredentialRecordInvalid
	}
	err := os.Remove(filepath.Join(s.dir, "credentials-"+versionID+".dpapi"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return ErrSecureStoreUnavailable
	}
	return nil
}

func writeProtectedBlob(ctx context.Context, path string, ciphertext []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
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
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := replaceCredentialFile(tempPath, path); err != nil {
		return ErrSecureStoreUnavailable
	}
	return nil
}

func replaceCredentialFile(tempPath, targetPath string) error {
	tempName, err := windows.UTF16PtrFromString(tempPath)
	if err != nil {
		return err
	}
	targetName, err := windows.UTF16PtrFromString(targetPath)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(tempName, targetName, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}

func syncCredentialDirectory(string) error { return nil }
