package protocol

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sync"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
)

const (
	defaultMaxRequests = 4
	defaultMaxControls = 2
)

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

type Server struct {
	Backend     contract.Backend
	Input       io.Reader
	Output      io.Writer
	MaxFrame    uint32
	MaxActive   int
	MaxControls int

	writeMu       sync.Mutex
	mu            sync.Mutex
	active        map[string]*operation
	infers        int
	auths         int
	workActive    int
	controlActive int
	loggingOut    bool
	wg            sync.WaitGroup
}

type request struct {
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Method    string          `json:"method"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type response struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	Sequence  uint64 `json:"sequence"`
	Event     string `json:"event,omitempty"`
	OK        *bool  `json:"ok,omitempty"`
	Payload   any    `json:"payload,omitempty"`
	Error     *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type operation struct {
	id     string
	method string
	cancel context.CancelFunc
	done   chan struct{}
	mu     sync.Mutex
	seq    uint64
	closed bool
}

func NewServer(backend contract.Backend, input io.Reader, output io.Writer) *Server {
	return &Server{
		Backend:     backend,
		Input:       input,
		Output:      output,
		MaxFrame:    MaxFrameBytes,
		MaxActive:   defaultMaxRequests,
		MaxControls: defaultMaxControls,
		active:      make(map[string]*operation),
	}
}

func (s *Server) Run(ctx context.Context) error {
	if s.Backend == nil || s.Input == nil || s.Output == nil {
		return errors.New("native messaging server is not configured")
	}
	if s.MaxFrame == 0 {
		s.MaxFrame = MaxFrameBytes
	}
	if s.MaxActive <= 0 {
		s.MaxActive = defaultMaxRequests
	}
	if s.MaxControls <= 0 {
		s.MaxControls = defaultMaxControls
	}
	for {
		frame, err := ReadFrame(s.Input, s.MaxFrame)
		if err == io.EOF {
			s.cancelActive()
			s.wg.Wait()
			return nil
		}
		if err != nil {
			s.cancelActive()
			s.wg.Wait()
			return err
		}
		var req request
		if err := decodeStrict(frame, &req); err != nil {
			if werr := s.immediateTerminal("", "invalid_request", "The request frame is invalid."); werr != nil {
				return werr
			}
			continue
		}
		if req.Type != "request" || !requestIDPattern.MatchString(req.RequestID) {
			if werr := s.immediateTerminal("", "invalid_request", "A valid request type and requestId are required."); werr != nil {
				return werr
			}
			continue
		}
		s.accept(ctx, req)
	}
}

func (s *Server) accept(parent context.Context, req request) {
	if req.Method == "auth.logout" {
		if err := decodeOptionalStrict(req.Payload, &struct{}{}); err != nil {
			_ = s.immediateTerminal(req.RequestID, "invalid_payload", "The auth.logout payload is invalid.")
			return
		}
	}
	s.mu.Lock()
	if _, exists := s.active[req.RequestID]; exists {
		s.mu.Unlock()
		_ = s.immediateTerminal(req.RequestID, "request_id_in_use", "requestId is already active.")
		return
	}
	control := req.Method == "cancel" || req.Method == "auth.logout"
	if control {
		if s.controlActive >= s.MaxControls {
			s.mu.Unlock()
			_ = s.immediateTerminal(req.RequestID, "busy", "The host has reached its active control limit.")
			return
		}
		if req.Method == "auth.logout" && s.loggingOut {
			s.mu.Unlock()
			_ = s.immediateTerminal(req.RequestID, "busy", "Sign-out is already in progress.")
			return
		}
	} else {
		if s.loggingOut {
			s.mu.Unlock()
			_ = s.immediateTerminal(req.RequestID, "signing_out", "The ChatGPT session is signing out. Try again shortly.")
			return
		}
		if s.workActive >= s.MaxActive {
			s.mu.Unlock()
			_ = s.immediateTerminal(req.RequestID, "busy", "The host has reached its active request limit.")
			return
		}
	}
	if req.Method == "infer.start" {
		if s.infers != 0 {
			s.mu.Unlock()
			_ = s.immediateTerminal(req.RequestID, "busy", "Only one inference can run at a time.")
			return
		}
		s.infers++
	}
	if req.Method == "auth.start" {
		if s.auths != 0 {
			s.mu.Unlock()
			_ = s.immediateTerminal(req.RequestID, "busy", "Only one sign-in flow can run at a time.")
			return
		}
		s.auths++
	}
	var waitForWork []<-chan struct{}
	if req.Method == "auth.logout" {
		s.loggingOut = true
		for _, active := range s.active {
			if active.method != "cancel" && active.method != "auth.logout" {
				active.cancel()
				waitForWork = append(waitForWork, active.done)
			}
		}
	}
	ctx, cancel := context.WithCancel(parent)
	op := &operation{id: req.RequestID, method: req.Method, cancel: cancel, done: make(chan struct{})}
	s.active[req.RequestID] = op
	if control {
		s.controlActive++
	} else {
		s.workActive++
	}
	s.wg.Add(1)
	s.mu.Unlock()

	go func() {
		defer s.wg.Done()
		defer cancel()
		defer func() {
			s.mu.Lock()
			delete(s.active, req.RequestID)
			if req.Method == "infer.start" && s.infers > 0 {
				s.infers--
			}
			if req.Method == "auth.start" && s.auths > 0 {
				s.auths--
			}
			if control && s.controlActive > 0 {
				s.controlActive--
			}
			if !control && s.workActive > 0 {
				s.workActive--
			}
			if req.Method == "auth.logout" {
				s.loggingOut = false
			}
			s.mu.Unlock()
		}()
		for _, done := range waitForWork {
			select {
			case <-done:
			case <-ctx.Done():
				op.terminal(s, false, nil, "cancelled", "The request was cancelled.")
				return
			}
		}
		s.dispatch(ctx, op, req)
	}()
}

func (s *Server) dispatch(ctx context.Context, op *operation, req request) {
	success := func(payload any) { op.terminal(s, true, payload, "", "") }
	fail := func(err error) { code, message := safeError(err); op.terminal(s, false, nil, code, message) }

	switch req.Method {
	case "hello":
		if err := decodeOptionalStrict(req.Payload, &struct{}{}); err != nil {
			fail(contract.NewError("invalid_payload", "The hello payload is invalid."))
			return
		}
		success(map[string]any{
			"protocolVersion": 1,
			"maxFrameBytes":   s.MaxFrame,
			"capabilities":    []string{"auth.status", "auth.start", "auth.logout", "models.list", "infer.start", "cancel"},
		})
	case "auth.status":
		result, err := s.Backend.AuthStatus(ctx)
		if err != nil {
			fail(err)
			return
		}
		success(result)
	case "auth.start":
		if err := decodeOptionalStrict(req.Payload, &struct{}{}); err != nil {
			fail(contract.NewError("invalid_payload", "The auth.start payload is invalid."))
			return
		}
		if err := s.Backend.StartAuth(ctx, func() { _ = op.event(s, "auth.waiting", nil) }); err != nil {
			fail(err)
			return
		}
		success(map[string]any{"connected": true})
	case "auth.logout":
		if err := decodeOptionalStrict(req.Payload, &struct{}{}); err != nil {
			fail(contract.NewError("invalid_payload", "The auth.logout payload is invalid."))
			return
		}
		confirmed, err := s.Backend.Logout(ctx)
		if err != nil {
			fail(err)
			return
		}
		success(map[string]any{"revocationConfirmed": confirmed})
	case "models.list":
		if err := decodeOptionalStrict(req.Payload, &struct{}{}); err != nil {
			fail(contract.NewError("invalid_payload", "The models.list payload is invalid."))
			return
		}
		models, err := s.Backend.ListModels(ctx)
		if err != nil {
			fail(err)
			return
		}
		success(map[string]any{"models": models})
	case "infer.start":
		var input contract.InferenceRequest
		if err := decodeRequiredStrict(req.Payload, &input); err != nil || !validInference(input) {
			fail(contract.NewError("invalid_payload", "The inference request is invalid or exceeds its size limit."))
			return
		}
		result, err := s.Backend.Infer(ctx, input, func(delta string) error {
			return op.event(s, "infer.delta", map[string]string{"text": delta})
		})
		if err != nil {
			fail(err)
			return
		}
		success(result)
	case "cancel":
		var input struct {
			RequestID string `json:"requestId"`
		}
		if err := decodeRequiredStrict(req.Payload, &input); err != nil || !requestIDPattern.MatchString(input.RequestID) {
			fail(contract.NewError("invalid_payload", "A valid target requestId is required."))
			return
		}
		s.mu.Lock()
		target := s.active[input.RequestID]
		s.mu.Unlock()
		if target == nil || target.method != "infer.start" || target.isClosed() {
			success(map[string]any{"cancelled": false})
			return
		}
		target.cancel()
		success(map[string]any{"cancelled": true})
	default:
		fail(contract.NewError("unknown_method", "The requested method is not supported."))
	}
}

func (op *operation) isClosed() bool {
	op.mu.Lock()
	defer op.mu.Unlock()
	return op.closed
}

func (op *operation) event(s *Server, name string, payload any) error {
	op.mu.Lock()
	defer op.mu.Unlock()
	if op.closed {
		return errors.New("request already completed")
	}
	message := response{Type: "event", RequestID: op.id, Sequence: op.seq, Event: name, Payload: payload}
	op.seq++
	return s.write(message)
}

func (op *operation) terminal(s *Server, ok bool, payload any, code, message string) {
	op.mu.Lock()
	defer op.mu.Unlock()
	if op.closed {
		return
	}
	op.closed = true
	close(op.done)
	result := response{Type: "terminal", RequestID: op.id, Sequence: op.seq, Payload: payload}
	op.seq++
	result.OK = &ok
	if !ok {
		result.Error = &struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}{Code: code, Message: message}
	}
	_ = s.write(result)
}

func (s *Server) immediateTerminal(id, code, message string) error {
	ok := false
	return s.write(response{
		Type:      "terminal",
		RequestID: id,
		Sequence:  0,
		OK:        &ok,
		Error: &struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}{Code: code, Message: message},
	})
}

func (s *Server) write(value response) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode native messaging response: %w", err)
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return WriteFrame(s.Output, data, s.MaxFrame)
}

func (s *Server) cancelActive() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, op := range s.active {
		op.cancel()
	}
}

func decodeStrict(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func decodeRequiredStrict(data json.RawMessage, target any) error {
	if len(data) == 0 || bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return errors.New("payload is required")
	}
	return decodeStrict(data, target)
}

func decodeOptionalStrict(data json.RawMessage, target any) error {
	if len(data) == 0 {
		return nil
	}
	return decodeStrict(data, target)
}

func safeError(err error) (string, string) {
	if err == nil {
		return "internal_error", "The request could not be completed."
	}
	var known *contract.Error
	if errors.As(err, &known) {
		return known.Code, known.Message
	}
	if errors.Is(err, context.Canceled) {
		return "cancelled", "The request was cancelled."
	}
	return "internal_error", "The request could not be completed."
}

func validInference(input contract.InferenceRequest) bool {
	return len(input.Model) > 0 && len(input.Model) <= 128 &&
		len(input.Instructions) <= 16*1024 && len(input.Input) > 0 && len(input.Input) <= 64*1024
}
