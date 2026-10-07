package siwc

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
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

func TestConcurrentExpiredConsumersRefreshRotatingTokenOnce(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, planUseScope+" offline_access", now)
	fake.refreshStarted = make(chan struct{})
	fake.refreshRelease = make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(fake.refreshRelease) })
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(-time.Minute))
	client := newTestClient(t, fake, store, now, false)

	ready := make(chan struct{}, 2)
	results := make(chan error, 2)
	for range 2 {
		go func() {
			ready <- struct{}{}
			_, err := client.ListModels(context.Background())
			results <- err
		}()
	}
	<-ready
	<-ready
	select {
	case <-fake.refreshStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the first consumer did not start token refresh")
	}
	releaseOnce.Do(func() { close(fake.refreshRelease) })
	for range 2 {
		select {
		case err := <-results:
			if err != nil {
				t.Fatalf("ListModels() during shared refresh: %v", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("a consumer did not finish after refresh released")
		}
	}
	calls, refreshes, _, _, _, refreshToken := fake.tokenStats()
	if calls != 1 || refreshes != 1 || refreshToken != "old-refresh-value" {
		t.Fatalf("refresh stats = calls:%d refreshes:%d token:%q; want one use of the old rotating token", calls, refreshes, refreshToken)
	}
	credential, ok, err := store.Load(context.Background())
	if err != nil || !ok || credential.RefreshToken != "rotated-refresh-value" {
		t.Fatalf("rotated token snapshot = %#v ok=%v err=%v", credential, ok, err)
	}
}

func TestLogoutCancelsBlockedAuthorizationAndRetainsRegistration(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, strings.Join(requestedScopes, " "), now)
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(time.Hour))
	started := make(chan struct{})
	client, err := New(Options{
		AgentName:   "TranslateFlow",
		Store:       store,
		HTTPClient:  fake.httpClient(),
		Now:         func() time.Time { return now },
		AuthTimeout: 3 * time.Second,
		OpenBrowser: func(context.Context, string) error {
			close(started)
			return nil // Leave the loopback callback pending until logout cancels it.
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	authDone := make(chan error, 1)
	go func() { authDone <- client.StartAuth(context.Background(), nil) }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("authorization did not reach the browser wait")
	}
	if _, err := client.Logout(context.Background()); err != nil {
		t.Fatalf("Logout() = %v", err)
	}
	select {
	case err := <-authDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("blocked StartAuth() = %v, want context cancellation", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("logout did not cancel and wait for the callback flow")
	}
	status, err := client.AuthStatus(context.Background())
	if err != nil || status.Connected || status.CanInfer {
		t.Fatalf("auth status after logout = %#v err=%v", status, err)
	}
	credential, ok, err := store.Load(context.Background())
	if err != nil || ok || credential.AccessToken != "" || credential.RefreshToken != "" ||
		credential.ClientID != testIssuedClientID || credential.HostID != "urn:uuid:offline-test-host" || credential.Subject != "offline-test-subject" {
		t.Fatalf("logout did not retain only the registration: %#v ok=%v err=%v", credential, ok, err)
	}
}

func TestLogoutCancelsBlockedRefreshWithoutResurrectingSession(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, planUseScope+" offline_access", now)
	fake.refreshStarted = make(chan struct{})
	fake.refreshRelease = make(chan struct{})
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(-time.Minute))
	client := newTestClient(t, fake, store, now, false)
	useDone := make(chan error, 1)
	go func() { _, err := client.ListModels(context.Background()); useDone <- err }()
	select {
	case <-fake.refreshStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("refresh did not reach the fake token endpoint")
	}
	if _, err := client.Logout(context.Background()); err != nil {
		t.Fatalf("Logout() = %v", err)
	}
	select {
	case <-useDone:
	case <-time.After(2 * time.Second):
		t.Fatal("logout did not cancel and wait for token refresh")
	}
	status, err := client.AuthStatus(context.Background())
	if err != nil || status.Connected || status.CanInfer {
		t.Fatalf("auth status after refresh/logout race = %#v err=%v", status, err)
	}
	credential, ok, err := store.Load(context.Background())
	if err != nil || ok || credential.AccessToken != "" || credential.RefreshToken != "" {
		t.Fatalf("late refresh resurrected session: %#v ok=%v err=%v", credential, ok, err)
	}
	_, refreshes, _, _, _, _ := fake.tokenStats()
	if refreshes != 1 {
		t.Fatalf("refresh calls = %d, want the single cancelled request", refreshes)
	}
}

func TestLogoutCancelsAndWaitsForInference(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, planUseScope+" offline_access", now)
	streamDelta := make(chan struct{})
	fake.responseHandler = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			return
		}
		_, _ = io.WriteString(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
		flusher.Flush()
		close(streamDelta)
		<-r.Context().Done()
	}
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(time.Hour))
	client := newTestClient(t, fake, store, now, false)
	inferDone := make(chan error, 1)
	go func() {
		result, err := client.Infer(context.Background(), contract.InferenceRequest{Model: "model-a", Input: "offline input"}, nil)
		if err == nil && result.Text != "" {
			inferDone <- errors.New("cancelled inference returned partial success")
			return
		}
		inferDone <- err
	}()
	select {
	case <-streamDelta:
	case <-time.After(2 * time.Second):
		t.Fatal("inference did not reach the blocking fake stream")
	}
	if _, err := client.Logout(context.Background()); err != nil {
		t.Fatalf("Logout() = %v", err)
	}
	select {
	case err := <-inferDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Infer() after logout = %v, want cancellation", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("logout returned without stopping the active inference")
	}
	status, err := client.AuthStatus(context.Background())
	if err != nil || status.Connected || status.CanInfer {
		t.Fatalf("auth status after inference/logout race = %#v err=%v", status, err)
	}
}

func TestStoreRejectsRefreshCommitFromInvalidatedGeneration(t *testing.T) {
	now := time.Now().UTC()
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(-time.Minute))
	snapshot, err := store.Snapshot(context.Background())
	if err != nil || !snapshot.HasSession {
		t.Fatalf("initial store snapshot = %#v err=%v", snapshot, err)
	}
	if _, err := store.InvalidateSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	stale := snapshot.Tokens
	stale.AccessToken = "late-refresh-access"
	stale.RefreshToken = "late-refresh-rotated"
	stale.Expiry = now.Add(time.Hour)
	committed, err := store.CommitRefresh(context.Background(), snapshot.Generation, stale)
	if err != nil || committed {
		t.Fatalf("stale generation refresh commit = committed:%v err:%v, want rejected", committed, err)
	}
	current, err := store.Snapshot(context.Background())
	if err != nil || current.HasSession || !current.HasRegistration || current.Registration.ClientID != testIssuedClientID {
		t.Fatalf("store after stale refresh = %#v err=%v", current, err)
	}

	authStore := NewMemoryStore()
	authSnapshot, err := authStore.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authStore.InvalidateSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	committed, err = authStore.CommitAuth(context.Background(), authSnapshot.Generation,
		Registration{ClientID: testIssuedClientID, HostID: "urn:uuid:offline-auth-host", Subject: "offline-subject"},
		SessionTokens{AccessToken: "late-login-token", Scopes: []string{planUseScope}, Expiry: now.Add(time.Hour)})
	if err != nil || committed {
		t.Fatalf("stale authorization commit = committed:%v err:%v, want rejected", committed, err)
	}
	authCurrent, err := authStore.Snapshot(context.Background())
	if err != nil || authCurrent.HasSession || authCurrent.HasRegistration {
		t.Fatalf("store after stale authorization = %#v err=%v", authCurrent, err)
	}
}

func TestLogoutDeadlineStillClearsLocalSessionWhenRevocationHangs(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, planUseScope+" offline_access", now)
	fake.revokeStarted = make(chan struct{})
	fake.revokeRelease = make(chan struct{})
	var releaseRevoke sync.Once
	defer releaseRevoke.Do(func() { close(fake.revokeRelease) })
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(time.Hour))
	client, err := New(Options{
		AgentName: "TranslateFlow", Store: store, HTTPClient: fake.httpClient(),
		Now: func() time.Time { return now }, AuthTimeout: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	logoutDone := make(chan struct {
		confirmed bool
		err       error
	}, 1)
	go func() {
		confirmed, err := client.Logout(context.Background())
		logoutDone <- struct {
			confirmed bool
			err       error
		}{confirmed: confirmed, err: err}
	}()
	select {
	case <-fake.revokeStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("revocation did not reach the fake endpoint")
	}
	status, err := client.AuthStatus(context.Background())
	if err != nil || status.Connected || status.CanInfer {
		t.Fatalf("auth status while revocation is blocked = %#v err=%v", status, err)
	}
	select {
	case result := <-logoutDone:
		if result.err != nil || result.confirmed {
			t.Fatalf("bounded Logout() = confirmed:%v err:%v, want false without error", result.confirmed, result.err)
		}
		releaseRevoke.Do(func() { close(fake.revokeRelease) })
	case <-time.After(2 * time.Second):
		t.Fatal("logout did not return after the total auth timeout")
	}
	status, err = client.AuthStatus(context.Background())
	if err != nil || status.Connected || status.CanInfer {
		t.Fatalf("auth status after blocked revocation = %#v err=%v", status, err)
	}
}

func TestAuthTimeoutStartsBeforeMetadataDiscovery(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, strings.Join(requestedScopes, " "), now)
	fake.metadataStarted = make(chan struct{})
	fake.metadataRelease = make(chan struct{})
	var releaseMetadata sync.Once
	defer releaseMetadata.Do(func() { close(fake.metadataRelease) })
	store := NewMemoryStore()
	client, err := New(Options{
		AgentName: "TranslateFlow", Store: store, HTTPClient: fake.httpClient(),
		Now: func() time.Time { return now }, AuthTimeout: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	startedAt := time.Now()
	authDone := make(chan error, 1)
	go func() { authDone <- client.StartAuth(context.Background(), nil) }()
	select {
	case <-fake.metadataStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("sign-in did not begin metadata discovery")
	}
	select {
	case err := <-authDone:
		if errorCode(err) != "authorization_timeout" {
			t.Fatalf("StartAuth() after discovery timeout = %v, want authorization_timeout", err)
		}
		if time.Since(startedAt) > 2*time.Second {
			t.Fatal("authentication timeout did not bound discovery")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("discovery ignored the bounded authentication context")
	}
	releaseMetadata.Do(func() { close(fake.metadataRelease) })
}

func TestLogoutReauthorizationReusesRegistrationWithoutOldTokenHint(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, strings.Join(requestedScopes, " "), now)
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(time.Hour))
	const stableHostID = "urn:uuid:offline-test-host"
	client, err := New(Options{
		AgentName:   "TranslateFlow",
		Store:       store,
		HTTPClient:  fake.httpClient(),
		Now:         func() time.Time { return now },
		AuthTimeout: 3 * time.Second,
		OpenBrowser: func(ctx context.Context, raw string) error {
			parsed, err := url.Parse(raw)
			if err != nil {
				return err
			}
			query := parsed.Query()
			if query.Get("client_id") != testIssuedClientID || query.Get("ext_agent_host_id") != stableHostID {
				return errors.New("sign-in did not reuse the stored registration")
			}
			if _, present := query["id_token_hint"]; present {
				return errors.New("sign-in sent a stale id_token_hint after logout")
			}
			return fake.beginAuthorization(ctx, raw, false)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Logout(context.Background()); err != nil {
		t.Fatalf("Logout() = %v", err)
	}
	status, err := client.AuthStatus(context.Background())
	if err != nil || status.Connected {
		t.Fatalf("status after logout = %#v err=%v", status, err)
	}
	if err := client.StartAuth(context.Background(), nil); err != nil {
		t.Fatalf("reauthorize after logout: %v", err)
	}
	credential, ok, err := store.Load(context.Background())
	if err != nil || !ok || credential.ClientID != testIssuedClientID || credential.HostID != stableHostID || credential.RefreshToken == "" {
		t.Fatalf("reauthorized session = %#v ok=%v err=%v", credential, ok, err)
	}
}

func TestStartAuthRejectsInvalidOIDCTokens(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tests := []struct {
		name     string
		mutate   func(map[string]any)
		badSig   bool
		wantCode string
	}{
		{name: "signature", badSig: true, wantCode: "id_token_invalid"},
		{name: "issuer", mutate: func(claims map[string]any) { claims["iss"] = "https://untrusted.invalid" }, wantCode: "id_token_invalid"},
		{name: "audience", mutate: func(claims map[string]any) { claims["aud"] = "another-client" }, wantCode: "id_token_invalid"},
		{name: "nonce", mutate: func(claims map[string]any) { claims["nonce"] = "wrong-offline-nonce" }, wantCode: "id_token_invalid"},
		{name: "expiry", mutate: func(claims map[string]any) { claims["exp"] = now.Add(-time.Minute).Unix() }, wantCode: "id_token_invalid"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fake := newFakeOpenAI(t, strings.Join(requestedScopes, " "), now)
			fake.identityMutator = test.mutate
			fake.invalidSignature = test.badSig
			store := NewMemoryStore()
			client := newTestClient(t, fake, store, now, false)
			if err := client.StartAuth(context.Background(), nil); errorCode(err) != test.wantCode {
				t.Fatalf("StartAuth() error code = %q, want %q (err %v)", errorCode(err), test.wantCode, err)
			}
			credential, ok, loadErr := store.Load(context.Background())
			if loadErr != nil || ok || credential.ClientID != "" {
				t.Fatalf("invalid identity token was committed: %#v ok=%v err=%v", credential, ok, loadErr)
			}
		})
	}
}

func TestStartAuthRejectsChangedIdentityAndReservedDynamicClientID(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	fake := newFakeOpenAI(t, strings.Join(requestedScopes, " "), now)
	fake.identityMutator = func(claims map[string]any) { claims["sub"] = "offline-other-subject" }
	store := NewMemoryStore()
	seedCredential(t, store, now.Add(time.Hour))
	client := newTestClient(t, fake, store, now, false)
	if err := client.StartAuth(context.Background(), nil); errorCode(err) != "account_mismatch" {
		t.Fatalf("identity mismatch error code = %q, want account_mismatch", errorCode(err))
	}

	fake = newFakeOpenAI(t, strings.Join(requestedScopes, " "), now)
	fake.callbackClientID = newClientID
	store = NewMemoryStore()
	client = newTestClient(t, fake, store, now, false)
	if err := client.StartAuth(context.Background(), nil); errorCode(err) != "registration_incomplete" {
		t.Fatalf("dynamic client ID error code = %q, want registration_incomplete", errorCode(err))
	}
	calls, _, _, _, _, _ := fake.tokenStats()
	if calls != 0 {
		t.Fatalf("token exchanges for reserved client ID = %d, want zero", calls)
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

func TestResponsesErrorAndIncompleteEventsFailImmediately(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantCode string
	}{
		{
			name:     "error cannot be overridden by completed",
			body:     "data: {\"type\":\"error\",\"response\":{\"error\":{\"code\":\"offline_failure\"}}}\n\ndata: {\"type\":\"response.completed\"}\n\n",
			wantCode: "inference_failed",
		},
		{
			name:     "incomplete response",
			body:     "data: {\"type\":\"response.incomplete\"}\n\n",
			wantCode: "inference_incomplete",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			now := time.Now().UTC().Truncate(time.Second)
			fake := newFakeOpenAI(t, planUseScope, now)
			fake.responseHandler = func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, test.body)
			}
			store := NewMemoryStore()
			seedCredential(t, store, now.Add(time.Hour))
			client := newTestClient(t, fake, store, now, false)
			result, err := client.Infer(context.Background(), contract.InferenceRequest{Model: "model-a", Input: "offline input"}, nil)
			if errorCode(err) != test.wantCode || result.Text != "" {
				t.Fatalf("Infer() = %#v, %v; want %s and no successful output", result, err, test.wantCode)
			}
		})
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
