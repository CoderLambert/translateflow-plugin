package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"runtime"
	"strings"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
	"github.com/CoderLambert/translateflow-plugin/native-host/internal/installer"
	"github.com/CoderLambert/translateflow-plugin/native-host/internal/protocol"
	"github.com/CoderLambert/translateflow-plugin/native-host/internal/siwc"
)

// Set at release build time with -ldflags -X main.pinnedExtensionID=<Chrome ID>.
// An empty value keeps development builds explicit about their allowlist.
var pinnedExtensionID string

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if isChromeHostInvocation(args) {
		return runHost()
	}
	if len(args) == 0 {
		if pinnedExtensionID == "" {
			fmt.Fprintln(os.Stderr, "This build has no pinned Chrome extension ID; no installation was performed.")
			return 2
		}
		return installCommand(nil)
	}
	switch args[0] {
	case "install":
		return installCommand(args[1:])
	case "uninstall":
		return uninstallCommand(args[1:])
	case "help", "--help", "-h":
		printUsage()
		return 0
	default:
		printUsage()
		return 2
	}
}

func isChromeHostInvocation(args []string) bool {
	return len(args) > 0 && strings.HasPrefix(args[0], "chrome-extension://")
}

func installCommand(args []string) int {
	flags := flag.NewFlagSet("install", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	extensionID := flags.String("extension-id", "", "exact Chrome extension ID (32 lowercase a-p characters)")
	browser := flags.String("browser", "chrome", "target browser: chrome or chromium (Linux; Windows supports chrome)")
	dryRun := flags.Bool("dry-run", false, "print the current-user install plan without changing files or registry")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return 2
	}
	if pinnedExtensionID != "" {
		if *extensionID != "" && *extensionID != pinnedExtensionID {
			fmt.Fprintln(os.Stderr, "The requested extension ID does not match this installer's pinned ID.")
			return 2
		}
		*extensionID = pinnedExtensionID
	}
	if *extensionID == "" {
		fmt.Fprintln(os.Stderr, "No Chrome extension ID is pinned; pass --extension-id or use the release-pinned installer.")
		return 2
	}
	source, err := os.Executable()
	if err == nil {
		err = installer.Install(*extensionID, *browser, source, *dryRun, os.Stdout)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if !*dryRun {
		fmt.Fprintln(os.Stdout, "TranslateFlow native host registered for the current user. Credentials were not changed.")
	}
	return 0
}

func uninstallCommand(args []string) int {
	flags := flag.NewFlagSet("uninstall", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	browser := flags.String("browser", "chrome", "target browser: chrome or chromium (Linux; Windows supports chrome)")
	dryRun := flags.Bool("dry-run", false, "print the current-user uninstall plan without changing files or registry")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return 2
	}
	if err := installer.Uninstall(*browser, *dryRun, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if !*dryRun {
		fmt.Fprintln(os.Stdout, "TranslateFlow native host registration removed if it belonged to this component; credentials were preserved.")
	}
	return 0
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "Usage: translateflow-host install [--extension-id ID] [--browser chrome|chromium] [--dry-run]")
	fmt.Fprintln(os.Stderr, "       translateflow-host uninstall [--browser chrome|chromium] [--dry-run]")
	fmt.Fprintln(os.Stderr, "A release-pinned build installs for the current user when opened with no arguments.")
}

func runHost() int {
	log.SetOutput(os.Stderr)
	log.SetFlags(0)

	store, releaseHost, startupErr := siwc.NewSystemStore()
	if startupErr != nil {
		store = siwc.NewMemoryStore()
		if errors.Is(startupErr, siwc.ErrHostBusy) {
			startupErr = contract.NewError("HOST_BUSY", "Another TranslateFlow native host is active. Close it and retry.")
		} else if runtime.GOOS == "linux" {
			startupErr = contract.NewError("credential_unavailable", "TranslateFlow could not initialize the current-user credential store. Check that your user config directory is writable.")
		} else {
			startupErr = contract.NewError("credential_unavailable", "TranslateFlow could not open the current-user secure credential store.")
		}
	} else {
		defer releaseHost()
	}
	client, err := siwc.New(siwc.Options{
		AgentName: "TranslateFlow",
		Store:     store,
	})
	if err != nil {
		log.Printf("native host initialization failed: %v", err)
		return 1
	}
	host := protocol.NewServer(client, os.Stdin, os.Stdout)
	host.StartupError = startupErr
	if err := host.Run(context.Background()); err != nil {
		log.Printf("native host stopped: %v", err)
		return 1
	}
	return 0
}
