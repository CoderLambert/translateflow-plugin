//go:build linux

package siwc

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicPointerSyncOpensCredentialDirectory(t *testing.T) {
	ctx := context.Background()
	credentialDir := filepath.Join(t.TempDir(), "credential-state")
	if err := os.Mkdir(credentialDir, 0o700); err != nil {
		t.Fatal(err)
	}
	pointerPath := filepath.Join(credentialDir, credentialPointerName)
	var syncPath, openedPath string
	err := writePrivateAtomicFileWithSync(ctx, pointerPath, []byte(`{"version":1}`), func(path string) error {
		syncPath = path
		return syncCredentialDirectoryWith(path, func(openPath string) (*os.File, error) {
			openedPath = openPath
			return os.Open(openPath)
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if syncPath != credentialDir {
		t.Fatalf("directory sync path = %q, want pointer parent %q", syncPath, credentialDir)
	}
	if openedPath != credentialDir {
		t.Fatalf("directory open path = %q, want pointer parent %q", openedPath, credentialDir)
	}
}
