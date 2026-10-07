package siwc

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
)

func TestStartAuthUsesPKCEAndRejectsIncorrectState(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, strings.Join(requestedScopes, " "), now)
	store := NewMemoryStore()
	client := newTestClient(t, fake, store, now, true)

	if err := client.StartAuth(context.Background(), nil); err != nil {
		calls, refreshes, clientID, pkceOK, resource, _ := fake.tokenStats()
		t.Fatalf("StartAuth() = %v; fake exchange stats calls:%d refreshes:%d clientID:%q pkce:%v resource:%q", err, calls, refreshes, clientID, pkceOK, resource)
	}
	credential, ok, err := store.Load(context.Background())
	if err != nil || !ok {
		t.Fatalf("saved credential: ok=%v err=%v", ok, err)
	}
	if credential.ClientID != testIssuedClientID || credential.Subject != "offline-test-subject" || credential.HostID == "" {
		t.Fatalf("saved identity does not match offline OAuth response: %#v", credential)
	}
	calls, refreshes, clientID, pkceOK, resource, _ := fake.tokenStats()
	if calls != 1 || refreshes != 0 || clientID != testIssuedClientID || !pkceOK || resource != resourceURL {
		t.Fatalf("exchange stats = calls:%d refreshes:%d clientID:%q pkce:%v resource:%q", calls, refreshes, clientID, pkceOK, resource)
	}
	status, err := client.AuthStatus(context.Background())
	if err != nil || !status.Connected || !status.CanInfer || status.Storage != "process-memory" {
		t.Fatalf("auth status = %#v, err=%v", status, err)
	}
	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].Slug != "model-a" {
		t.Fatalf("visible models = %#v, want only model-a", models)
	}
	fake.mu.Lock()
	modelAuthorization := fake.modelAuthorization
	fake.mu.Unlock()
	if modelAuthorization != "Bearer offline-access-value" {
		t.Fatalf("models Authorization = %q", modelAuthorization)
	}
}

func TestStartAuthRejectsInsufficientGrantedScope(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	granted := []string{"openid", "profile", "email", "offline_access", "resource.invoke"}
	fake := newFakeOpenAI(t, strings.Join(granted, " "), now)
	store := NewMemoryStore()
	client := newTestClient(t, fake, store, now, false)

	err := client.StartAuth(context.Background(), nil)
	if code := errorCode(err); code != "missing_scope" {
		t.Fatalf("StartAuth() error code = %q, want missing_scope (err %v)", code, err)
	}
	credential, ok, loadErr := store.Load(context.Background())
	if loadErr != nil || !ok || credential.ClientID != testIssuedClientID || credential.AccessToken == "" {
		t.Fatalf("verified identity should be retained for reauthorization: credential=%#v ok=%v err=%v", credential, ok, loadErr)
	}
	status, err := client.AuthStatus(context.Background())
	if err != nil || !status.Connected || status.CanInfer {
		t.Fatalf("insufficient-scope auth status = %#v, err=%v", status, err)
	}
	if _, err := client.ListModels(context.Background()); errorCode(err) != "missing_scope" {
		t.Fatalf("models without plan scope error code = %q, want missing_scope", errorCode(err))
	}
	calls, _, _, _, _, _ := fake.tokenStats()
	if calls != 1 {
		t.Fatalf("token exchanges = %d, want one valid-state exchange; invalid-state callback must not reach token endpoint", calls)
	}
}

func TestReauthorizationReusesIssuedClientAndStableHostID(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, strings.Join(requestedScopes, " "), now)
	store := NewMemoryStore()
	const stableHostID = "urn:uuid:offline-existing-host"
	if err := store.Save(context.Background(), Credential{
		ClientID:     testIssuedClientID,
		HostID:       stableHostID,
		Subject:      "offline-test-subject",
		Email:        "offline@example.invalid",
		IDToken:      "retained-id-token-hint",
		AccessToken:  "previous-access-value",
		RefreshToken: "old-refresh-value",
		Scopes:       requestedScopes,
		Expiry:       now.Add(-time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	client, err := New(Options{
		AgentName:  "TranslateFlow",
		Store:      store,
		HTTPClient: fake.httpClient(),
		Now:        func() time.Time { return now },
		OpenBrowser: func(ctx context.Context, raw string) error {
			parsed, err := url.Parse(raw)
			if err != nil {
				return err
			}
			query := parsed.Query()
			if query.Get("client_id") != testIssuedClientID || query.Get("agent_name_hint") != "" ||
				query.Get("id_token_hint") != "retained-id-token-hint" || query.Get("ext_agent_host_id") != stableHostID {
				return errors.New("returning authorization did not retain the selected registration")
			}
			fake.setExpectedChallenge(query.Get("code_challenge"))
			identity, err := fake.signIdentityToken(query.Get("nonce"), testIssuedClientID)
			if err != nil {
				return err
			}
			fake.setIdentityToken(identity)
			callback, err := url.Parse(query.Get("redirect_uri"))
			if err != nil {
				return err
			}
			callbackQuery := url.Values{}
			callbackQuery.Set("state", query.Get("state"))
			callbackQuery.Set("code", "offline-test-code")
			callback.RawQuery = callbackQuery.Encode() // Returning sign-in may omit client_id.
			status, err := getCallback(ctx, callback.String())
			if err != nil {
				return err
			}
			if status != http.StatusOK {
				return errors.New("returning callback was rejected")
			}
			return nil
		},
		AuthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.StartAuth(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	credential, ok, err := store.Load(context.Background())
	if err != nil || !ok || credential.ClientID != testIssuedClientID || credential.HostID != stableHostID {
		t.Fatalf("reauthorized credential = %#v, ok=%v err=%v", credential, ok, err)
	}
}

func TestExpiredAccessTokenRefreshesBeforeModelRequest(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, planUseScope+" offline_access", now)
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(-time.Minute))
	client := newTestClient(t, fake, store, now, false)

	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 {
		t.Fatalf("models = %#v", models)
	}
	calls, refreshes, _, _, _, oldRefresh := fake.tokenStats()
	if calls != 1 || refreshes != 1 || oldRefresh != "old-refresh-value" {
		t.Fatalf("refresh stats = calls:%d refreshes:%d token:%q", calls, refreshes, oldRefresh)
	}
	fake.mu.Lock()
	modelAuthorization := fake.modelAuthorization
	fake.mu.Unlock()
	if modelAuthorization != "Bearer refreshed-access-value" {
		t.Fatalf("models Authorization = %q, want the refreshed access token", modelAuthorization)
	}
	credential, ok, err := store.Load(context.Background())
	if err != nil || !ok || credential.AccessToken != "refreshed-access-value" || credential.RefreshToken != "rotated-refresh-value" {
		t.Fatalf("rotated credentials were not saved atomically: %#v ok=%v err=%v", credential, ok, err)
	}
}

func TestFailedResponsesStreamNeverReturnsSuccess(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, planUseScope, now)
	fake.responseHandler = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
		_, _ = io.WriteString(w, "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"offline_failure\"}}}\n\n")
	}
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(time.Hour))
	client := newTestClient(t, fake, store, now, false)
	var deltas []string
	result, err := client.Infer(context.Background(), contract.InferenceRequest{Model: "model-a", Input: "offline input"}, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	if errorCode(err) != "inference_failed" || result.Text != "" {
		t.Fatalf("Infer() = %#v, %v; failed stream must not produce success", result, err)
	}
	if strings.Join(deltas, "") != "partial" {
		t.Fatalf("deltas = %#v, want the streamed partial text before failure", deltas)
	}
}

func TestResponsesStreamRequiresCompletedEvent(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, planUseScope, now)
	fake.responseHandler = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
	}
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(time.Hour))
	client := newTestClient(t, fake, store, now, false)
	result, err := client.Infer(context.Background(), contract.InferenceRequest{Model: "model-a", Input: "offline input"}, nil)
	if errorCode(err) != "stream_incomplete" || result.Text != "" {
		t.Fatalf("Infer() = %#v, %v; EOF without response.completed must fail", result, err)
	}
}

func TestInferenceCancellationStopsStreamWithoutSuccess(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, planUseScope, now)
	fake.responseHandler = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			return
		}
		_, _ = io.WriteString(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
		flusher.Flush()
		<-r.Context().Done()
	}
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(time.Hour))
	client := newTestClient(t, fake, store, now, false)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	deltaSeen := make(chan struct{}, 1)
	resultCh := make(chan struct {
		result contract.InferenceResult
		err    error
	}, 1)
	go func() {
		result, err := client.Infer(ctx, contract.InferenceRequest{Model: "model-a", Input: "offline input"}, func(string) error {
			deltaSeen <- struct{}{}
			return nil
		})
		resultCh <- struct {
			result contract.InferenceResult
			err    error
		}{result: result, err: err}
	}()
	select {
	case <-deltaSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive the first fake SSE delta")
	}
	cancel()
	select {
	case result := <-resultCh:
		if !errors.Is(result.err, context.Canceled) || result.result.Text != "" {
			t.Fatalf("cancelled Infer() = %#v, %v", result.result, result.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled fake SSE stream did not stop")
	}
}

func TestCompletedResponsesStreamReturnsAccumulatedText(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, planUseScope, now)
	fake.responseHandler = func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer expired-access-value" {
			t.Errorf("Responses Authorization header = %q", r.Header.Get("Authorization"))
		}
		var body responsesRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode Responses request: %v", err)
		} else if body.Model != "model-a" || body.Instructions != "translate" || body.Store || !body.Stream ||
			len(body.Input) != 1 || len(body.Input[0].Content) != 1 || body.Input[0].Content[0].Text != "offline input" {
			t.Errorf("Responses request did not match the SIWC contract: %#v", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n")
		_, _ = io.WriteString(w, "data: {\"type\":\"response.completed\"}\n\n")
	}
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(time.Hour))
	client := newTestClient(t, fake, store, now, false)
	result, err := client.Infer(context.Background(), contract.InferenceRequest{Model: "model-a", Instructions: "translate", Input: "offline input"}, nil)
	if err != nil || result.Text != "ok" {
		t.Fatalf("Infer() = %#v, err=%v", result, err)
	}
}

func TestAuthorizationEndpointAllowlistRejectsLookalikes(t *testing.T) {
	for _, raw := range []string{"https://auth.openai.com.evil.test/api/accounts/authorize", "https://openai.com/api/accounts/authorize", "http://auth.openai.com/api/accounts/authorize"} {
		if officialHTTPS(raw) {
			t.Errorf("officialHTTPS(%q) unexpectedly accepted an untrusted origin", raw)
		}
	}
}

func newTestClient(t *testing.T, fake *fakeOpenAI, store *MemoryStore, now time.Time, rejectWrongState bool) *Client {
	t.Helper()
	client, err := New(Options{
		AgentName:  "TranslateFlow",
		Store:      store,
		HTTPClient: fake.httpClient(),
		OpenBrowser: func(ctx context.Context, raw string) error {
			return fake.beginAuthorization(ctx, raw, rejectWrongState)
		},
		Now:         func() time.Time { return now },
		AuthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func seedCredential(t *testing.T, store *MemoryStore, expiry time.Time) {
	t.Helper()
	if err := store.Save(context.Background(), Credential{
		ClientID:     testIssuedClientID,
		HostID:       "urn:uuid:offline-test-host",
		Subject:      "offline-test-subject",
		IDToken:      "offline-id-token",
		AccessToken:  "expired-access-value",
		RefreshToken: "old-refresh-value",
		Scopes:       []string{planUseScope, "offline_access"},
		Expiry:       expiry,
	}); err != nil {
		t.Fatal(err)
	}
}

func errorCode(err error) string {
	var known *contract.Error
	if errors.As(err, &known) {
		return known.Code
	}
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	return ""
}
