package main

import (
	"context"
	"log"
	"os"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/protocol"
	"github.com/CoderLambert/translateflow-plugin/native-host/internal/siwc"
)

func main() {
	log.SetOutput(os.Stderr)
	log.SetFlags(0)

	client, err := siwc.New(siwc.Options{
		AgentName: "TranslateFlow",
		Store:     siwc.NewSystemStore(),
	})
	if err != nil {
		log.Printf("native host initialization failed: %v", err)
		os.Exit(1)
	}
	host := protocol.NewServer(client, os.Stdin, os.Stdout)
	if err := host.Run(context.Background()); err != nil {
		log.Printf("native host stopped: %v", err)
		os.Exit(1)
	}
}
