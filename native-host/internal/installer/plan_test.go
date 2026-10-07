package installer

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

const fixtureExtensionID = "abcdefghijklmnopabcdefghijklmnop"

func TestInstallPlansUseOneExactChromeExtensionOrigin(t *testing.T) {
	home := filepath.Join(t.TempDir(), "home")
	config := filepath.Join(home, ".config")
	plan, err := LinuxInstallPlan(home, config, fixtureExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Browser != "Google Chrome stable" || plan.HostName != HostName || plan.Action != "install" {
		t.Fatalf("unexpected plan identity: %+v", plan)
	}
	if got, want := plan.NativeManifest.AllowedOrigins, []string{"chrome-extension://" + fixtureExtensionID + "/"}; !equalStrings(got, want) {
		t.Fatalf("allowed_origins = %#v, want %#v", got, want)
	}
	encoded, err := EncodeManifest(*plan.NativeManifest)
	if err != nil {
		t.Fatal(err)
	}
	var manifest NativeManifest
	if err := json.Unmarshal(encoded, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Name != HostName || manifest.Path != plan.BinaryPath || manifest.Type != "stdio" {
		t.Fatalf("unexpected host manifest: %+v", manifest)
	}
	if strings.Contains(string(encoded), "*") {
		t.Fatal("host manifest must not contain wildcard origins")
	}
}

func TestWindowsPlanTargetsCurrentUserChromeRegistryAndLocalAppData(t *testing.T) {
	localAppData := filepath.Join(t.TempDir(), "LocalAppData")
	plan, err := WindowsInstallPlan(localAppData, fixtureExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(plan.BinaryPath, localAppData) || !strings.HasPrefix(plan.ManifestPath, localAppData) {
		t.Fatalf("Windows files escaped LocalAppData: %+v", plan)
	}
	if plan.Registration != `HKCU\`+RegistryKey {
		t.Fatalf("registration = %q", plan.Registration)
	}
}

func TestExtensionIDMustBeAnExactChromeID(t *testing.T) {
	for _, value := range []string{"", "short", "abcdefghijklmnopabcdefghijklmnopq", "abcdefghijklmnopabcdefghijklmn0", "*" + fixtureExtensionID[1:]} {
		if err := ValidateExtensionID(value); err == nil {
			t.Errorf("ValidateExtensionID(%q) unexpectedly succeeded", value)
		}
	}
	if err := ValidateExtensionID(fixtureExtensionID); err != nil {
		t.Fatal(err)
	}
}

func TestOwnershipCheckRejectsDifferentPathOrMultipleOrigins(t *testing.T) {
	manifest := NativeManifest{Name: HostName, Description: Description, Path: filepath.Join(t.TempDir(), "translateflow-host"),
		Type: "stdio", AllowedOrigins: []string{"chrome-extension://" + fixtureExtensionID + "/"}}
	encoded, err := EncodeManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !IsOwnedManifest(encoded, manifest.Path) {
		t.Fatal("expected exact component manifest to be recognized")
	}
	if IsOwnedManifest(encoded, manifest.Path+".other") {
		t.Fatal("manifest with a different executable path must not be treated as owned")
	}
	manifest.AllowedOrigins = append(manifest.AllowedOrigins, "chrome-extension://"+strings.Repeat("a", 32)+"/")
	encoded, err = EncodeManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if IsOwnedManifest(encoded, manifest.Path) {
		t.Fatal("manifest that grants another extension must not be deleted as ours")
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
