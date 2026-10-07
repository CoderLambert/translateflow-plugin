package siwc

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"
)

const testIssuedClientID = "oaiapp_translateflow_test"

type fakeOpenAI struct {
	server *httptest.Server
	key    *rsa.PrivateKey
	now    time.Time

	mu                 sync.Mutex
	identityToken      string
	expectedChallenge  string
	grantScope         string
	tokenCalls         int
	refreshCalls       int
	codeClientID       string
	codeVerifierValid  bool
	codeResource       string
	modelAuthorization string
	refreshToken       string
	responseHandler    http.HandlerFunc
}

func newFakeOpenAI(t *testing.T, grantedScope string, now time.Time) *fakeOpenAI {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	fake := &fakeOpenAI{key: key, now: now, grantScope: grantedScope}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(providerInfo{
			Issuer:                issuerURL,
			AuthorizationEndpoint: authorizeURL,
			TokenEndpoint:         tokenURL,
			JWKSURI:               issuerURL + "/keys",
			RevocationEndpoint:    issuerURL + "/api/accounts/oauth/revoke",
		})
	})
	mux.HandleFunc("/keys", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(fake.jwks())
	})
	mux.HandleFunc("/api/accounts/oauth/token", fake.handleToken)
	mux.HandleFunc("/v1/models", fake.handleModels)
	mux.HandleFunc("/v1/responses", fake.handleResponses)
	fake.server = httptest.NewServer(mux)
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeOpenAI) httpClient() *http.Client {
	return &http.Client{
		Transport: rewriteTransport{target: f.server.URL},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func (f *fakeOpenAI) handleToken(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	f.tokenCalls++
	grantType := r.Form.Get("grant_type")
	if grantType == "authorization_code" {
		f.codeClientID = r.Form.Get("client_id")
		f.codeResource = r.Form.Get("resource")
		f.codeVerifierValid = oauthChallengeValid(r.Form.Get("code_verifier"), f.expectedChallenge)
		if r.Form.Get("code") != "offline-test-code" || !f.codeVerifierValid ||
			f.codeClientID != testIssuedClientID || f.codeResource != resourceURL {
			f.mu.Unlock()
			http.Error(w, "invalid authorization exchange", http.StatusBadRequest)
			return
		}
		identity := f.identityToken
		scope := f.grantScope
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(tokenResponse{
			AccessToken:  "offline-access-value",
			RefreshToken: "offline-refresh-value",
			IDToken:      identity,
			TokenType:    "Bearer",
			ExpiresIn:    3600,
			Scope:        scope,
		})
		return
	}
	if grantType == "refresh_token" {
		f.refreshCalls++
		f.refreshToken = r.Form.Get("refresh_token")
		clientID := r.Form.Get("client_id")
		resource := r.Form.Get("resource")
		f.mu.Unlock()
		if clientID != testIssuedClientID || resource != resourceURL || f.refreshToken != "old-refresh-value" {
			http.Error(w, "invalid refresh", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(tokenResponse{
			AccessToken:  "refreshed-access-value",
			RefreshToken: "rotated-refresh-value",
			TokenType:    "Bearer",
			ExpiresIn:    3600,
			Scope:        f.grantScope,
		})
		return
	}
	f.mu.Unlock()
	http.Error(w, "unsupported grant", http.StatusBadRequest)
}

func (f *fakeOpenAI) handleModels(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.modelAuthorization = r.Header.Get("Authorization")
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"models":[{"visibility":"list","slug":"model-a","display_name":"Model A"},{"visibility":"hidden","slug":"model-hidden","display_name":"Hidden"}]}`)
}

func (f *fakeOpenAI) handleResponses(w http.ResponseWriter, r *http.Request) {
	if f.responseHandler != nil {
		f.responseHandler(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	_, _ = io.WriteString(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n")
	_, _ = io.WriteString(w, "data: {\"type\":\"response.completed\"}\n\n")
}

func (f *fakeOpenAI) setIdentityToken(raw string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.identityToken = raw
}

func (f *fakeOpenAI) setExpectedChallenge(value string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.expectedChallenge = value
}

func (f *fakeOpenAI) jwks() map[string]any {
	e := big.NewInt(int64(f.key.PublicKey.E)).Bytes()
	return map[string]any{"keys": []map[string]string{{
		"kty": "RSA",
		"kid": "offline-test-key",
		"use": "sig",
		"alg": "RS256",
		"n":   base64.RawURLEncoding.EncodeToString(f.key.PublicKey.N.Bytes()),
		"e":   base64.RawURLEncoding.EncodeToString(e),
	}}}
}

func (f *fakeOpenAI) signIdentityToken(nonce, clientID string) (string, error) {
	header, err := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": "offline-test-key"})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]any{
		"iss":   issuerURL,
		"sub":   "offline-test-subject",
		"aud":   clientID,
		"iat":   f.now.Add(-time.Minute).Unix(),
		"exp":   f.now.Add(time.Hour).Unix(),
		"nonce": nonce,
		"email": "offline@example.invalid",
	})
	if err != nil {
		return "", err
	}
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(input))
	signature, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func (f *fakeOpenAI) beginAuthorization(ctx context.Context, rawURL string, rejectWrongState bool) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "auth.openai.com" || parsed.Path != "/api/accounts/authorize" {
		return errorsForTest("authorization did not target the official endpoint")
	}
	query := parsed.Query()
	if query.Get("response_type") != "code" || query.Get("resource") != resourceURL || query.Get("code_challenge_method") != "S256" {
		return errorsForTest("authorization parameters are incomplete")
	}
	if query.Get("client_id") != newClientID || query.Get("agent_name_hint") != "TranslateFlow" {
		return errorsForTest("initial registration parameters are incorrect")
	}
	if query.Get("ext_agent_host_id") == "" || len(query.Get("state")) < 40 || len(query.Get("nonce")) < 40 {
		return errorsForTest("host ID, state, or nonce is missing")
	}
	f.setExpectedChallenge(query.Get("code_challenge"))
	identity, err := f.signIdentityToken(query.Get("nonce"), testIssuedClientID)
	if err != nil {
		return err
	}
	f.setIdentityToken(identity)
	redirect, err := url.Parse(query.Get("redirect_uri"))
	if err != nil || redirect.Scheme != "http" || redirect.Hostname() != "127.0.0.1" || redirect.Path != callbackPath {
		return errorsForTest("callback is not bound to the expected loopback address")
	}
	if rejectWrongState {
		wrong := *redirect
		wrongQuery := queryForCallback(query.Get("state")+"-wrong", "offline-test-code")
		wrong.RawQuery = wrongQuery.Encode()
		status, err := getCallback(ctx, wrong.String())
		if err != nil {
			return err
		}
		if status != http.StatusBadRequest {
			return errorsForTest("a callback with the wrong state was not rejected")
		}
	}
	callback := *redirect
	callback.RawQuery = queryForCallback(query.Get("state"), "offline-test-code").Encode()
	status, err := getCallback(ctx, callback.String())
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return errorsForTest("valid callback was not accepted")
	}
	return nil
}

func queryForCallback(state, code string) url.Values {
	values := url.Values{}
	values.Set("state", state)
	values.Set("code", code)
	values.Set("client_id", testIssuedClientID)
	return values
}

func getCallback(ctx context.Context, rawURL string) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	return response.StatusCode, nil
}

type rewriteTransport struct{ target string }

func (transport rewriteTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	parsed, err := url.Parse(transport.target)
	if err != nil {
		return nil, err
	}
	urlCopy := *clone.URL
	urlCopy.Scheme = parsed.Scheme
	urlCopy.Host = parsed.Host
	clone.URL = &urlCopy
	clone.Host = parsed.Host
	return http.DefaultTransport.RoundTrip(clone)
}

func oauthChallengeValid(verifier, challenge string) bool {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:]) == challenge && verifier != ""
}

func errorsForTest(message string) error { return fmt.Errorf("test setup: %s", message) }

func (f *fakeOpenAI) tokenStats() (calls, refreshCalls int, codeClientID string, verifierValid bool, resource, refreshToken string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.tokenCalls, f.refreshCalls, f.codeClientID, f.codeVerifierValid, f.codeResource, f.refreshToken
}
