package installer

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	HostName        = "com.coderlambert.translateflow"
	Description     = "TranslateFlow ChatGPT Native Host"
	BrowserChrome   = "Google Chrome stable"
	BrowserChromium = "Chromium"
	RegistryKey     = `Software\Google\Chrome\NativeMessagingHosts\` + HostName
)

var ErrRegistrationConflict = errors.New("a non-TranslateFlow native host registration already uses this path")

type NativeManifest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Path           string   `json:"path"`
	Type           string   `json:"type"`
	AllowedOrigins []string `json:"allowed_origins"`
}

type Plan struct {
	Action         string          `json:"action"`
	Browser        string          `json:"browser"`
	HostName       string          `json:"host_name"`
	ExtensionID    string          `json:"extension_id,omitempty"`
	BinaryPath     string          `json:"binary_path"`
	ManifestPath   string          `json:"manifest_path"`
	Registration   string          `json:"registration"`
	NativeManifest *NativeManifest `json:"native_manifest,omitempty"`
}

func ValidateExtensionID(extensionID string) error {
	if len(extensionID) != 32 {
		return fmt.Errorf("extension ID must be exactly 32 lowercase characters from a through p")
	}
	for _, char := range extensionID {
		if char < 'a' || char > 'p' {
			return fmt.Errorf("extension ID must be exactly 32 lowercase characters from a through p")
		}
	}
	return nil
}

func LinuxInstallPlan(home, configDir, extensionID string) (Plan, error) {
	return LinuxInstallPlanForBrowser(home, configDir, "chrome", extensionID)
}

func LinuxInstallPlanForBrowser(home, configDir, browser, extensionID string) (Plan, error) {
	if err := ValidateExtensionID(extensionID); err != nil {
		return Plan{}, err
	}
	browserLabel, binaryPath, manifestPath, err := LinuxInstallPaths(home, configDir, browser)
	if err != nil {
		return Plan{}, err
	}
	return installPlan(browserLabel, extensionID, binaryPath, manifestPath, "user manifest file: "+manifestPath)
}

func LinuxInstallPaths(home, configDir, browser string) (string, string, string, error) {
	var browserLabel, browserDir string
	switch browser {
	case "chrome":
		browserLabel, browserDir = BrowserChrome, "google-chrome"
	case "chromium":
		browserLabel, browserDir = BrowserChromium, "chromium"
	default:
		return "", "", "", fmt.Errorf("unsupported Linux browser %q; choose chrome or chromium", browser)
	}
	home, err := filepath.Abs(home)
	if err != nil {
		return "", "", "", err
	}
	configDir, err = filepath.Abs(configDir)
	if err != nil {
		return "", "", "", err
	}
	binaryPath := filepath.Join(home, ".local", "share", "translateflow", "native-host", "translateflow-host")
	manifestPath := filepath.Join(configDir, browserDir, "NativeMessagingHosts", HostName+".json")
	return browserLabel, binaryPath, manifestPath, nil
}

func WindowsInstallPlan(localAppData, extensionID string) (Plan, error) {
	if err := ValidateExtensionID(extensionID); err != nil {
		return Plan{}, err
	}
	root, err := filepath.Abs(filepath.Join(localAppData, "TranslateFlow", "NativeHost"))
	if err != nil {
		return Plan{}, err
	}
	binaryPath := filepath.Join(root, "translateflow-host.exe")
	manifestPath := filepath.Join(root, HostName+".json")
	return installPlan(BrowserChrome, extensionID, binaryPath, manifestPath, `HKCU\`+RegistryKey)
}

func UninstallPlan(browser, binaryPath, manifestPath, registration string) Plan {
	return Plan{Action: "uninstall", Browser: browser, HostName: HostName, BinaryPath: binaryPath,
		ManifestPath: manifestPath, Registration: registration}
}

func installPlan(browser, extensionID, binaryPath, manifestPath, registration string) (Plan, error) {
	if !filepath.IsAbs(binaryPath) || !filepath.IsAbs(manifestPath) || strings.TrimSpace(registration) == "" {
		return Plan{}, fmt.Errorf("installer paths must be absolute and registration must be explicit")
	}
	manifest := &NativeManifest{Name: HostName, Description: Description, Path: binaryPath, Type: "stdio",
		AllowedOrigins: []string{"chrome-extension://" + extensionID + "/"}}
	return Plan{Action: "install", Browser: browser, HostName: HostName, ExtensionID: extensionID,
		BinaryPath: binaryPath, ManifestPath: manifestPath, Registration: registration, NativeManifest: manifest}, nil
}

func EncodeManifest(manifest NativeManifest) ([]byte, error) {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func IsOwnedManifest(data []byte, expectedBinary string) bool {
	var manifest NativeManifest
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return false
	}
	if manifest.Name != HostName || manifest.Description != Description || manifest.Type != "stdio" ||
		!samePath(manifest.Path, expectedBinary) || len(manifest.AllowedOrigins) != 1 {
		return false
	}
	origin := manifest.AllowedOrigins[0]
	if !strings.HasPrefix(origin, "chrome-extension://") || !strings.HasSuffix(origin, "/") {
		return false
	}
	return ValidateExtensionID(strings.TrimSuffix(strings.TrimPrefix(origin, "chrome-extension://"), "/")) == nil
}

func PrintPlan(out io.Writer, plan Plan) error {
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", "  ")
	return encoder.Encode(plan)
}

func copyExecutable(source, destination string) error {
	source, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return err
	}
	if samePath(source, destination) {
		return nil
	}
	sourceFile, err := os.Open(source)
	if err != nil {
		return err
	}
	defer sourceFile.Close()
	info, err := sourceFile.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("native host executable source is not a regular file")
	}
	dir := filepath.Dir(destination)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(dir, ".translateflow-host-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := io.Copy(temporary, sourceFile); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Chmod(0700); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return replaceFile(temporaryPath, destination)
}

func writeManifestAtomic(path string, manifest NativeManifest) error {
	data, err := EncodeManifest(manifest)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(dir, ".translateflow-manifest-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return replaceFile(temporaryPath, path)
}

func removeIfExists(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func removeEmptyDirs(paths ...string) {
	for _, path := range paths {
		_ = os.Remove(path)
	}
}

func samePath(a, b string) bool {
	a, errA := filepath.Abs(a)
	b, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		return false
	}
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}
