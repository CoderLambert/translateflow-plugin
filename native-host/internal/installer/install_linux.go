//go:build linux

package installer

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func currentInstallPlan(extensionID, browser string) (Plan, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Plan{}, err
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		return Plan{}, err
	}
	return LinuxInstallPlanForBrowser(home, configDir, browser, extensionID)
}

func currentUninstallPlan(browser string) (Plan, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Plan{}, err
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		return Plan{}, err
	}
	home, err = filepath.Abs(home)
	if err != nil {
		return Plan{}, err
	}
	configDir, err = filepath.Abs(configDir)
	if err != nil {
		return Plan{}, err
	}
	browserLabel, binaryPath, manifestPath, err := LinuxInstallPaths(home, configDir, browser)
	if err != nil {
		return Plan{}, err
	}
	return UninstallPlan(browserLabel, binaryPath, manifestPath, "user manifest file: "+manifestPath), nil
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
		return fmt.Errorf("write current-user native host manifest: %w", err)
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
	manifest, err := os.ReadFile(plan.ManifestPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !IsOwnedManifest(manifest, plan.BinaryPath) {
		return ErrRegistrationConflict
	}
	shared, err := hasOwnedOtherBrowserRegistration(plan)
	if err != nil {
		return err
	}
	if err := removeIfExists(plan.ManifestPath); err != nil {
		return err
	}
	if !shared {
		if err := removeIfExists(plan.BinaryPath); err != nil {
			return err
		}
	}
	removeEmptyDirs(filepath.Dir(plan.ManifestPath), filepath.Dir(filepath.Dir(plan.ManifestPath)))
	if !shared {
		removeEmptyDirs(filepath.Dir(plan.BinaryPath), filepath.Dir(filepath.Dir(plan.BinaryPath)))
	}
	return nil
}

func ownedInstall(plan Plan) (bool, error) {
	manifest, err := os.ReadFile(plan.ManifestPath)
	if errors.Is(err, os.ErrNotExist) {
		if info, binaryErr := os.Lstat(plan.BinaryPath); binaryErr == nil {
			if !info.Mode().IsRegular() {
				return false, ErrRegistrationConflict
			}
			shared, otherErr := hasOwnedOtherBrowserRegistration(plan)
			if otherErr != nil {
				return false, otherErr
			}
			if shared {
				return true, nil
			}
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

func hasOwnedOtherBrowserRegistration(plan Plan) (bool, error) {
	configDir := filepath.Dir(filepath.Dir(filepath.Dir(plan.ManifestPath)))
	otherBrowserDir := ""
	switch plan.Browser {
	case BrowserChrome:
		otherBrowserDir = "chromium"
	case BrowserChromium:
		otherBrowserDir = "google-chrome"
	default:
		return false, ErrRegistrationConflict
	}
	otherPath := filepath.Join(configDir, otherBrowserDir, "NativeMessagingHosts", HostName+".json")
	manifest, err := os.ReadFile(otherPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !IsOwnedManifest(manifest, plan.BinaryPath) {
		return false, ErrRegistrationConflict
	}
	return true, nil
}
