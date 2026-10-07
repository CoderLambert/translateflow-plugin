//go:build linux

package siwc

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	dbus "github.com/godbus/dbus/v5"
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

func TestSessionBusAddressRequiresAUsableUnixAddress(t *testing.T) {
	if _, err := sessionBusSocketAddress(""); err != ErrSecureStoreUnavailable {
		t.Fatalf("empty session bus address error = %v, want ErrSecureStoreUnavailable", err)
	}
	got, err := sessionBusSocketAddress("unix:path=/run/user/1000/bus")
	if err != nil || got != "/run/user/1000/bus" {
		t.Fatalf("session bus socket = %q, err=%v", got, err)
	}
}

func TestSecretServiceLockedAndUnavailableErrorsStayDistinct(t *testing.T) {
	if got := normalizeSecretServiceError(context.Background(), ErrSecureStoreLocked); got != ErrSecureStoreLocked {
		t.Fatalf("locked error = %v", got)
	}
	locked := dbus.Error{Name: "org.freedesktop.Secret.Error.IsLocked"}
	if got := normalizeSecretServiceError(context.Background(), locked); got != ErrSecureStoreLocked {
		t.Fatalf("D-Bus locked error = %v", got)
	}
	if got := normalizeSecretServiceError(context.Background(), os.ErrNotExist); got != ErrSecureStoreUnavailable {
		t.Fatalf("unavailable service error = %v", got)
	}
	lockedMessage := credentialStoreError(ErrSecureStoreLocked).Error()
	unavailableMessage := credentialStoreError(ErrSecureStoreUnavailable).Error()
	if !strings.Contains(lockedMessage, "Secret Service") || !strings.Contains(lockedMessage, "will not unlock") {
		t.Fatalf("locked Secret Service message is unclear: %q", lockedMessage)
	}
	if !strings.Contains(unavailableMessage, "session D-Bus") || !strings.Contains(unavailableMessage, "DBUS_SESSION_BUS_ADDRESS") || !strings.Contains(unavailableMessage, "will not install") {
		t.Fatalf("unavailable D-Bus/Secret Service message is unclear: %q", unavailableMessage)
	}
}
