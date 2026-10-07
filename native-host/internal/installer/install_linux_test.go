//go:build linux

package installer

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLinuxDryRunUsesIsolatedUserPathsAndDoesNotCreateFiles(t *testing.T) {
	home := t.TempDir()
	config := filepath.Join(home, ".config")
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", config)
	var output bytes.Buffer
	if err := Install(fixtureExtensionID, "chrome", "", true, &output); err != nil {
		t.Fatal(err)
	}
	var plan Plan
	if err := json.Unmarshal(output.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.ExtensionID != fixtureExtensionID || plan.NativeManifest == nil {
		t.Fatalf("unexpected dry-run plan: %+v", plan)
	}
	for _, path := range []string{plan.BinaryPath, plan.ManifestPath} {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("dry-run created or changed %s: %v", path, err)
		}
	}
}

func TestLinuxInstallAndUninstallFixturePreserveOtherUserData(t *testing.T) {
	home := t.TempDir()
	config := filepath.Join(home, ".config")
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", config)
	credentialPointer := filepath.Join(config, "translateflow", "credential-pointer.json")
	unrelatedHost := filepath.Join(config, "google-chrome", "NativeMessagingHosts", "other-host.json")
	writeFixture(t, credentialPointer, []byte("fixture credential metadata"))
	writeFixture(t, unrelatedHost, []byte(`{"name":"org.example.other"}`))
	source, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	plan, err := LinuxInstallPlan(home, config, fixtureExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	if err := Install(fixtureExtensionID, "chrome", source, false, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	manifestBytes, err := os.ReadFile(plan.ManifestPath)
	if err != nil || !IsOwnedManifest(manifestBytes, plan.BinaryPath) {
		t.Fatalf("installed manifest did not match its exact owner: err=%v", err)
	}
	if err := Uninstall("chrome", false, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{plan.BinaryPath, plan.ManifestPath} {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("owned install path was not removed: %s: %v", path, err)
		}
	}
	for _, path := range []string{credentialPointer, unrelatedHost} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("uninstall removed unrelated user data %s: %v", path, err)
		}
	}
}

func TestLinuxInstallRefusesToOverwriteForeignRegistration(t *testing.T) {
	home := t.TempDir()
	config := filepath.Join(home, ".config")
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", config)
	plan, err := LinuxInstallPlan(home, config, fixtureExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	writeFixture(t, plan.ManifestPath, []byte(`{"name":"org.example.other","type":"stdio"}`))
	source, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err := Install(fixtureExtensionID, "chrome", source, false, &bytes.Buffer{}); !errors.Is(err, ErrRegistrationConflict) {
		t.Fatalf("Install error = %v, want ErrRegistrationConflict", err)
	}
	if _, err := os.Lstat(plan.BinaryPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("conflict handling created executable: %v", err)
	}
}

func TestLinuxChromiumInstallUsesItsUserNativeMessagingDirectory(t *testing.T) {
	home := t.TempDir()
	config := filepath.Join(home, ".config")
	plan, err := LinuxInstallPlanForBrowser(home, config, "chromium", fixtureExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(config, "chromium", "NativeMessagingHosts", HostName+".json")
	if plan.Browser != BrowserChromium || plan.ManifestPath != want {
		t.Fatalf("Chromium plan = %+v, want manifest %q", plan, want)
	}
	chromePlan, err := LinuxInstallPlanForBrowser(home, config, "chrome", fixtureExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	if chromePlan.ManifestPath == plan.ManifestPath || !strings.Contains(chromePlan.ManifestPath, "google-chrome") {
		t.Fatalf("Chrome and Chromium must use separate user registration paths: chrome=%q chromium=%q", chromePlan.ManifestPath, plan.ManifestPath)
	}
}

func TestLinuxUninstallKeepsSharedExecutableUntilBothBrowsersAreRemoved(t *testing.T) {
	home := t.TempDir()
	config := filepath.Join(home, ".config")
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", config)
	source, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	chrome, err := LinuxInstallPlanForBrowser(home, config, "chrome", fixtureExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	chromium, err := LinuxInstallPlanForBrowser(home, config, "chromium", fixtureExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	for _, browser := range []string{"chrome", "chromium"} {
		if err := Install(fixtureExtensionID, browser, source, false, &bytes.Buffer{}); err != nil {
			t.Fatalf("install %s: %v", browser, err)
		}
	}
	if chrome.BinaryPath != chromium.BinaryPath {
		t.Fatal("expected both registrations to point at the same user executable")
	}
	if err := Uninstall("chrome", false, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(chrome.BinaryPath); err != nil {
		t.Fatalf("Chrome removal deleted the executable still used by Chromium: %v", err)
	}
	if _, err := os.Stat(chromium.ManifestPath); err != nil {
		t.Fatalf("Chrome removal deleted Chromium's manifest: %v", err)
	}
	if err := Uninstall("chromium", false, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(chrome.BinaryPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("last browser removal did not remove the shared executable: %v", err)
	}
}

func writeFixture(t *testing.T, path string, contents []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, contents, 0600); err != nil {
		t.Fatal(err)
	}
}
