package protocol

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
)

type blockingBackend struct {
	started chan struct{}
	once    sync.Once
}

func (b *blockingBackend) AuthStatus(context.Context) (contract.AuthStatus, error) {
	return contract.AuthStatus{Storage: "test"}, nil
}

func (b *blockingBackend) StartAuth(_ context.Context, waiting func()) error {
	waiting()
	return nil
}

func (b *blockingBackend) Logout(context.Context) (bool, error) { return true, nil }

func (b *blockingBackend) ListModels(context.Context) ([]contract.Model, error) {
	return []contract.Model{{Slug: "fake-model", DisplayName: "Fake Model"}}, nil
}

func (b *blockingBackend) Infer(ctx context.Context, _ contract.InferenceRequest, _ func(string) error) (contract.InferenceResult, error) {
	b.once.Do(func() { close(b.started) })
	<-ctx.Done()
	return contract.InferenceResult{}, ctx.Err()
}

type logoutOrderingBackend struct {
	started       chan struct{}
	inferenceDone chan struct{}
	logoutCalled  chan struct{}
	logoutSawDone bool
	startedOnce   sync.Once
	inferenceOnce sync.Once
	logoutOnce    sync.Once
}

func (b *logoutOrderingBackend) AuthStatus(context.Context) (contract.AuthStatus, error) {
	return contract.AuthStatus{}, nil
}

func (b *logoutOrderingBackend) StartAuth(context.Context, func()) error { return nil }

func (b *logoutOrderingBackend) Logout(context.Context) (bool, error) {
	select {
	case <-b.inferenceDone:
		b.logoutSawDone = true
	default:
	}
	b.logoutOnce.Do(func() { close(b.logoutCalled) })
	return true, nil
}

func (b *logoutOrderingBackend) ListModels(context.Context) ([]contract.Model, error) {
	return nil, nil
}

func (b *logoutOrderingBackend) Infer(ctx context.Context, _ contract.InferenceRequest, _ func(string) error) (contract.InferenceResult, error) {
	b.startedOnce.Do(func() { close(b.started) })
	<-ctx.Done()
	b.inferenceOnce.Do(func() { close(b.inferenceDone) })
	return contract.InferenceResult{}, ctx.Err()
}

func TestServerCancelProducesOneTerminalPerRequest(t *testing.T) {
	input := new(bytes.Buffer)
	writeRequest(t, input, map[string]any{
		"type": "request", "requestId": "infer-1", "method": "infer.start",
		"payload": map[string]string{"model": "fake-model", "input": "offline fixture", "instructions": ""},
	})
	writeRequest(t, input, map[string]any{
		"type": "request", "requestId": "cancel-1", "method": "cancel",
		"payload": map[string]string{"requestId": "infer-1"},
	})
	backend := &blockingBackend{started: make(chan struct{})}
	output := new(bytes.Buffer)
	server := NewServer(backend, input, output)
	if err := server.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	<-backend.started

	frames := readResponses(t, output)
	terminalByID := make(map[string][]response)
	for _, frame := range frames {
		if frame.Type == "terminal" {
			terminalByID[frame.RequestID] = append(terminalByID[frame.RequestID], frame)
		}
	}
	if len(terminalByID["infer-1"]) != 1 || len(terminalByID["cancel-1"]) != 1 {
		t.Fatalf("terminal counts = %#v, want one for each request", terminalByID)
	}
	if terminalByID["infer-1"][0].OK == nil || *terminalByID["infer-1"][0].OK {
		t.Fatal("cancelled inference unexpectedly completed successfully")
	}
	if terminalByID["infer-1"][0].Error == nil || terminalByID["infer-1"][0].Error.Code != "cancelled" {
		t.Fatalf("cancelled inference terminal = %#v", terminalByID["infer-1"][0])
	}
	if terminalByID["cancel-1"][0].OK == nil || !*terminalByID["cancel-1"][0].OK {
		t.Fatalf("cancel request terminal = %#v, want success", terminalByID["cancel-1"][0])
	}
	for id, responses := range map[string][]response{"infer-1": terminalByID["infer-1"], "cancel-1": terminalByID["cancel-1"]} {
		if responses[0].Sequence != 0 {
			t.Fatalf("%s terminal sequence = %d, want 0", id, responses[0].Sequence)
		}
	}
}

func TestServerUnknownMethodGetsOneSafeTerminal(t *testing.T) {
	input := new(bytes.Buffer)
	writeRequest(t, input, map[string]any{"type": "request", "requestId": "unknown-1", "method": "arbitrary.url"})
	output := new(bytes.Buffer)
	server := NewServer(&blockingBackend{started: make(chan struct{})}, input, output)
	if err := server.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	frames := readResponses(t, output)
	if len(frames) != 1 || frames[0].Type != "terminal" || frames[0].RequestID != "unknown-1" {
		t.Fatalf("responses = %#v, want one terminal", frames)
	}
	if frames[0].Error == nil || frames[0].Error.Code != "unknown_method" {
		t.Fatalf("response error = %#v, want unknown_method", frames[0].Error)
	}
	if frames[0].Error.Message != "The requested method is not supported." {
		t.Fatalf("error message = %q, want sanitized fixed text", frames[0].Error.Message)
	}
}

func TestLogoutWaitsForActiveInferenceToStop(t *testing.T) {
	inputReader, inputWriter := io.Pipe()
	backend := &logoutOrderingBackend{
		started:       make(chan struct{}),
		inferenceDone: make(chan struct{}),
		logoutCalled:  make(chan struct{}),
	}
	output := new(bytes.Buffer)
	server := NewServer(backend, inputReader, output)
	runDone := make(chan error, 1)
	go func() { runDone <- server.Run(context.Background()) }()
	writeRequest(t, inputWriter, map[string]any{
		"type": "request", "requestId": "infer-logout", "method": "infer.start",
		"payload": map[string]string{"model": "fake-model", "input": "offline fixture", "instructions": ""},
	})
	select {
	case <-backend.started:
	case <-time.After(2 * time.Second):
		t.Fatal("inference did not start")
	}
	writeRequest(t, inputWriter, map[string]any{"type": "request", "requestId": "logout-1", "method": "auth.logout"})
	select {
	case <-backend.logoutCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("logout did not run")
	}
	if err := inputWriter.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-runDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("native host did not stop after input closed")
	}
	if !backend.logoutSawDone {
		t.Fatal("auth.logout ran before the active inference stopped")
	}
	frames := readResponses(t, output)
	terminals := make(map[string]int)
	for _, frame := range frames {
		if frame.Type == "terminal" {
			terminals[frame.RequestID]++
		}
	}
	if terminals["infer-logout"] != 1 || terminals["logout-1"] != 1 {
		t.Fatalf("terminal counts = %#v, want one per accepted request", terminals)
	}
}

func writeRequest(t *testing.T, output io.Writer, request any) {
	t.Helper()
	data, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteFrame(output, data, MaxFrameBytes); err != nil {
		t.Fatal(err)
	}
}

func readResponses(t *testing.T, input *bytes.Buffer) []response {
	t.Helper()
	var results []response
	for {
		frame, err := ReadFrame(input, MaxFrameBytes)
		if err == io.EOF {
			return results
		}
		if err != nil {
			t.Fatal(err)
		}
		var result response
		if err := json.Unmarshal(frame, &result); err != nil {
			t.Fatal(err)
		}
		results = append(results, result)
	}
}
