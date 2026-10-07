//go:build windows

package installer

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

func currentInstallPlan(extensionID, browser string) (Plan, error) {
	if browser != "chrome" {
		return Plan{}, fmt.Errorf("Windows currently supports --browser chrome only")
	}
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return Plan{}, fmt.Errorf("LOCALAPPDATA is not available for the current Windows user")
	}
	return WindowsInstallPlan(localAppData, extensionID)
}

func currentUninstallPlan(browser string) (Plan, error) {
	if browser != "chrome" {
		return Plan{}, fmt.Errorf("Windows currently supports --browser chrome only")
	}
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return Plan{}, fmt.Errorf("LOCALAPPDATA is not available for the current Windows user")
	}
	root, err := filepath.Abs(filepath.Join(localAppData, "TranslateFlow", "NativeHost"))
	if err != nil {
		return Plan{}, err
	}
	manifestPath := filepath.Join(root, HostName+".json")
	return UninstallPlan(BrowserChrome, filepath.Join(root, "translateflow-host.exe"), manifestPath,
		`HKCU\`+RegistryKey), nil
}

func Install(extensionID, browser, source string, dryRun bool, out io.Writer) error {
	plan, err := currentInstallPlan(extensionID, browser)
	if err != nil {
		return err
	}
	if dryRun {
		return PrintPlan(out, plan)
	}
	owned, err := ownedInstall(plan)
	if err != nil {
		return err
	}
	if err := copyExecutable(source, plan.BinaryPath); err != nil {
		return fmt.Errorf("copy native host into the current user's install directory: %w", err)
	}
	if err := writeManifestAtomic(plan.ManifestPath, *plan.NativeManifest); err != nil {
		if !owned {
			_ = removeIfExists(plan.BinaryPath)
			removeEmptyDirs(filepath.Dir(plan.BinaryPath))
		}
		return fmt.Errorf("write Chrome native host manifest: %w", err)
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, RegistryKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("register current-user Chrome native host: %w", err)
	}
	defer key.Close()
	if err := key.SetStringValue("", plan.ManifestPath); err != nil {
		if !owned {
			_ = removeIfExists(plan.ManifestPath)
			_ = removeIfExists(plan.BinaryPath)
			removeEmptyDirs(filepath.Dir(plan.BinaryPath))
		}
		return fmt.Errorf("set current-user Chrome native host manifest path: %w", err)
	}
	return nil
}

func Uninstall(browser string, dryRun bool, out io.Writer) error {
	plan, err := currentUninstallPlan(browser)
	if err != nil {
		return err
	}
	if dryRun {
		return PrintPlan(out, plan)
	}
	registeredPath, registered, err := registeredManifestPath()
	if err != nil {
		return err
	}
	if registered && !samePath(registeredPath, plan.ManifestPath) {
		return ErrRegistrationConflict
	}
	manifest, manifestErr := os.ReadFile(plan.ManifestPath)
	if errors.Is(manifestErr, os.ErrNotExist) {
		if registered {
			if err := registry.DeleteKey(registry.CURRENT_USER, RegistryKey); err != nil {
				return err
			}
		}
		return nil
	}
	if manifestErr != nil {
		return manifestErr
	}
	if !IsOwnedManifest(manifest, plan.BinaryPath) {
		return ErrRegistrationConflict
	}
	if registered {
		if err := registry.DeleteKey(registry.CURRENT_USER, RegistryKey); err != nil {
			return err
		}
	}
	if err := removeIfExists(plan.ManifestPath); err != nil {
		return err
	}
	if err := removeIfExists(plan.BinaryPath); err != nil {
		return err
	}
	removeEmptyDirs(filepath.Dir(plan.BinaryPath))
	return nil
}

func ownedInstall(plan Plan) (bool, error) {
	registeredPath, registered, err := registeredManifestPath()
	if err != nil {
		return false, err
	}
	if registered && !samePath(registeredPath, plan.ManifestPath) {
		return false, ErrRegistrationConflict
	}
	manifest, err := os.ReadFile(plan.ManifestPath)
	if errors.Is(err, os.ErrNotExist) {
		if registered {
			return false, ErrRegistrationConflict
		}
		if _, binaryErr := os.Lstat(plan.BinaryPath); binaryErr == nil {
			return false, ErrRegistrationConflict
		} else if !errors.Is(binaryErr, os.ErrNotExist) {
			return false, binaryErr
		}
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !IsOwnedManifest(manifest, plan.BinaryPath) {
		return false, ErrRegistrationConflict
	}
	if info, err := os.Lstat(plan.BinaryPath); err == nil && !info.Mode().IsRegular() {
		return false, ErrRegistrationConflict
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	return true, nil
}

func registeredManifestPath() (string, bool, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, RegistryKey, registry.QUERY_VALUE)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return "", false, nil
		}
		return "", false, err
	}
	defer key.Close()
	path, _, err := key.GetStringValue("")
	if err != nil {
		return "", true, err
	}
	return path, true, nil
}
