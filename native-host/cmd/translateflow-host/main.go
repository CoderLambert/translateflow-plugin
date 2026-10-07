package main

import (
	"context"
	"errors"
	"log"
	"os"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
	"github.com/CoderLambert/translateflow-plugin/native-host/internal/protocol"
	"github.com/CoderLambert/translateflow-plugin/native-host/internal/siwc"
)

func main() {
	os.Exit(run())
}

func run() int {
	log.SetOutput(os.Stderr)
	log.SetFlags(0)

	store, releaseHost, startupErr := siwc.NewSystemStore()
	if startupErr != nil {
		store = siwc.NewMemoryStore()
		if errors.Is(startupErr, siwc.ErrHostBusy) {
			startupErr = contract.NewError("HOST_BUSY", "Another TranslateFlow native host is active. Close it and retry.")
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
