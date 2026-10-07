package protocol

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
)

type blockingBackend struct {
	started chan struct{}
	stopped chan struct{}
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
	if b.stopped != nil {
		close(b.stopped)
	}
	return contract.InferenceResult{}, ctx.Err()
}

type capacityBackend struct {
	started      chan string
	logoutCalled chan struct{}
	logoutOnce   sync.Once
}

func (b *capacityBackend) AuthStatus(context.Context) (contract.AuthStatus, error) {
	return contract.AuthStatus{}, nil
}
func (b *capacityBackend) StartAuth(context.Context, func()) error { return nil }
func (b *capacityBackend) Logout(context.Context) (bool, error) {
	b.logoutOnce.Do(func() { close(b.logoutCalled) })
	return true, nil
}
func (b *capacityBackend) ListModels(ctx context.Context) ([]contract.Model, error) {
	b.started <- "models"
	<-ctx.Done()
	return nil, ctx.Err()
}
func (b *capacityBackend) Infer(ctx context.Context, _ contract.InferenceRequest, _ func(string) error) (contract.InferenceResult, error) {
	b.started <- "infer"
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
	inputReader, inputWriter := io.Pipe()
	backend := &blockingBackend{started: make(chan struct{}), stopped: make(chan struct{})}
	output := new(bytes.Buffer)
	server := NewServer(backend, inputReader, output)
	runDone := make(chan error, 1)
	go func() { runDone <- server.Run(context.Background()) }()
	writeRequest(t, inputWriter, map[string]any{
		"type": "request", "requestId": "infer-1", "method": "infer.start",
		"payload": map[string]string{"model": "fake-model", "input": "offline fixture", "instructions": ""},
	})
	select {
	case <-backend.started:
	case <-time.After(2 * time.Second):
		t.Fatal("inference did not start before cancellation")
	}
	writeRequest(t, inputWriter, map[string]any{
		"type": "request", "requestId": "cancel-1", "method": "cancel",
		"payload": map[string]string{"requestId": "infer-1"},
	})
	select {
	case <-backend.stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("cancel did not stop the active inference while input remained open")
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
		t.Fatal("native host did not stop after the cancellation exchange")
	}

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
	cancelPayload, ok := terminalByID["cancel-1"][0].Payload.(map[string]any)
	if !ok || cancelPayload["cancelled"] != true {
		t.Fatalf("cancel request payload = %#v, want cancelled:true", terminalByID["cancel-1"][0].Payload)
	}
	for id, responses := range map[string][]response{"infer-1": terminalByID["infer-1"], "cancel-1": terminalByID["cancel-1"]} {
		if responses[0].Sequence != 0 {
			t.Fatalf("%s terminal sequence = %d, want 0", id, responses[0].Sequence)
		}
	}
}

func TestCancelAndLogoutUseControlCapacityWhenWorkLimitIsFull(t *testing.T) {
	inputReader, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	backend := &capacityBackend{started: make(chan string, 8), logoutCalled: make(chan struct{})}
	server := NewServer(backend, inputReader, outputWriter)
	server.MaxActive = 4
	runDone := make(chan error, 1)
	go func() { runDone <- server.Run(context.Background()) }()

	writeRequest(t, inputWriter, map[string]any{
		"type": "request", "requestId": "full-infer", "method": "infer.start",
		"payload": map[string]string{"model": "fake-model", "input": "offline fixture", "instructions": ""},
	})
	select {
	case <-backend.started:
	case <-time.After(2 * time.Second):
		t.Fatal("inference did not occupy a work slot")
	}
	for i := 0; i < 3; i++ {
		id := fmt.Sprintf("full-model-%d", i)
		writeRequest(t, inputWriter, map[string]any{"type": "request", "requestId": id, "method": "models.list"})
	}
	for i := 0; i < 3; i++ {
		select {
		case <-backend.started:
		case <-time.After(2 * time.Second):
			t.Fatal("models.list did not fill the work capacity")
		}
	}

	frames := make(chan response, 16)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			frame, err := ReadFrame(outputReader, MaxFrameBytes)
			if err != nil {
				return
			}
			var result response
			if json.Unmarshal(frame, &result) == nil {
				frames <- result
			}
		}
	}()
	writeRequest(t, inputWriter, map[string]any{
		"type": "request", "requestId": "control-cancel", "method": "cancel",
		"payload": map[string]string{"requestId": "full-infer"},
	})
	collected := make([]response, 0, 8)
	for {
		select {
		case frame := <-frames:
			collected = append(collected, frame)
			if frame.Type == "terminal" && frame.RequestID == "control-cancel" {
				payload, ok := frame.Payload.(map[string]any)
				if !ok || payload["cancelled"] != true {
					t.Fatalf("cancel response = %#v, want cancelled:true while work slots are full", frame)
				}
				goto cancelAccepted
			}
		case <-time.After(2 * time.Second):
			t.Fatal("cancel was rejected while work slots were full")
		}
	}

cancelAccepted:
	for !hasTerminal(collected, "full-infer") {
		select {
		case frame := <-frames:
			collected = append(collected, frame)
		case <-time.After(2 * time.Second):
			t.Fatal("the cancelled inference did not release its work slot")
		}
	}
	writeRequest(t, inputWriter, map[string]any{"type": "request", "requestId": "full-model-3", "method": "models.list"})
	select {
	case <-backend.started:
		// The cancelled inference released one slot, bringing active work back
		// to four before the following logout request is sent.
	case <-time.After(2 * time.Second):
		t.Fatal("the fourth blocked work request did not start")
	}
	writeRequest(t, inputWriter, map[string]any{"type": "request", "requestId": "control-logout", "method": "auth.logout"})
	select {
	case <-backend.logoutCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("auth.logout did not reach backend while work slots were full")
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
		t.Fatal("server did not finish after full-capacity logout")
	}
	_ = outputWriter.Close()
	<-readDone
	for {
		select {
		case frame := <-frames:
			collected = append(collected, frame)
		default:
			goto framesCollected
		}
	}

framesCollected:
	terminals := make(map[string]response)
	for _, frame := range collected {
		if frame.Type == "terminal" {
			terminals[frame.RequestID] = frame
		}
	}
	logout := terminals["control-logout"]
	logoutPayload, ok := logout.Payload.(map[string]any)
	if !ok || logout.OK == nil || !*logout.OK || logoutPayload["revocationConfirmed"] != true {
		t.Fatalf("auth.logout response = %#v, want success despite full work capacity", logout)
	}
	for _, id := range []string{"full-infer", "full-model-0", "full-model-1", "full-model-2", "full-model-3"} {
		if _, ok := terminals[id]; !ok {
			t.Errorf("request %s has no terminal response", id)
		}
	}
}

func hasTerminal(frames []response, requestID string) bool {
	for _, frame := range frames {
		if frame.Type == "terminal" && frame.RequestID == requestID {
			return true
		}
	}
	return false
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

func TestInvalidLogoutDoesNotCancelActiveWork(t *testing.T) {
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
		"type": "request", "requestId": "invalid-logout-infer", "method": "infer.start",
		"payload": map[string]string{"model": "fake-model", "input": "offline fixture", "instructions": ""},
	})
	select {
	case <-backend.started:
	case <-time.After(2 * time.Second):
		t.Fatal("inference did not start")
	}
	writeRequest(t, inputWriter, map[string]any{
		"type": "request", "requestId": "invalid-logout", "method": "auth.logout",
		"payload": map[string]string{"unexpected": "field"},
	})
	if err := inputWriter.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-runDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not exit after closing input")
	}
	select {
	case <-backend.logoutCalled:
		t.Fatal("invalid auth.logout unexpectedly reached backend")
	default:
	}
	frames := readResponses(t, output)
	var found bool
	for _, frame := range frames {
		if frame.RequestID == "invalid-logout" {
			found = frame.Type == "terminal" && frame.Error != nil && frame.Error.Code == "invalid_payload"
		}
	}
	if !found {
		t.Fatalf("invalid auth.logout response not found in %#v", frames)
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
