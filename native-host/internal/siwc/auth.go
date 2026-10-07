package siwc

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	callbackPath     = "/auth/callback"
	maxTokenBodySize = 128 << 10
)

type callbackResult struct {
	code     string
	clientID string
	err      error
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        string `json:"scope"`
}

func (c *Client) StartAuth(ctx context.Context, waiting func()) error {
	authCtx, cancel := context.WithTimeout(ctx, c.authTimeout)
	defer cancel()
	operationCtx, finish, err := c.beginOperation(authCtx)
	if err != nil {
		return err
	}
	defer finish()

	snapshot, err := c.store.Snapshot(operationCtx)
	if err != nil {
		if operationCtx.Err() != nil {
			return authorizationContextError(operationCtx)
		}
		return credentialStoreError(err)
	}
	old := snapshot.credential()
	returning := snapshot.HasRegistration
	if returning && (old.ClientID == "" || old.HostID == "") {
		return contract.NewError("credential_invalid", "The saved ChatGPT registration is incomplete.")
	}
	metadata, err := c.provider(operationCtx)
	if err != nil {
		if operationCtx.Err() != nil {
			return authorizationContextError(operationCtx)
		}
		return err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return contract.NewError("callback_unavailable", "A temporary loopback sign-in callback could not be started.")
	}
	defer listener.Close()
	redirectURI := "http://" + listener.Addr().String() + callbackPath

	state, err := randomURLToken(32)
	if err != nil {
		return contract.NewError("auth_start_failed", "ChatGPT sign-in could not be started.")
	}
	nonce, err := randomURLToken(32)
	if err != nil {
		return contract.NewError("auth_start_failed", "ChatGPT sign-in could not be started.")
	}
	verifier := oauth2.GenerateVerifier()
	hostID := c.hostID
	authorizationClientID := newClientID
	if returning {
		authorizationClientID = old.ClientID
		hostID = old.HostID
	}

	callback := make(chan callbackResult, 1)
	var callbackOnce sync.Once
	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			result := validateCallbackRequest(r, listener.Addr().String(), state, authorizationClientID, returning)
			if result.err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, "Sign-in could not be completed. Return to TranslateFlow and try again.")
				var known *contract.Error
				if !errors.As(result.err, &known) || (known.Code != "state_mismatch" && known.Code != "invalid_callback") {
					callbackOnce.Do(func() { callback <- result })
				}
				return
			}
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = io.WriteString(w, "Sign-in complete. Return to TranslateFlow.")
			callbackOnce.Do(func() { callback <- result })
		}),
	}
	serveDone := make(chan struct{})
	go func() {
		defer close(serveDone)
		_ = server.Serve(listener)
	}()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		<-serveDone
	}()

	values := url.Values{}
	values.Set("client_id", authorizationClientID)
	values.Set("ext_agent_host_id", hostID)
	values.Set("response_type", "code")
	values.Set("redirect_uri", redirectURI)
	values.Set("scope", strings.Join(requestedScopes, " "))
	values.Set("resource", resourceURL)
	values.Set("state", state)
	values.Set("nonce", nonce)
	values.Set("code_challenge_method", "S256")
	values.Set("code_challenge", oauth2.S256ChallengeFromVerifier(verifier))
	if returning {
		if snapshot.HasSession && snapshot.Tokens.IDToken != "" {
			values.Set("id_token_hint", snapshot.Tokens.IDToken)
		}
		if old.Email != "" {
			values.Set("login_hint", old.Email)
		}
	} else {
		values.Set("agent_name_hint", c.agentName)
	}
	if !officialHTTPS(authorizeURL) {
		return contract.NewError("auth_start_failed", "ChatGPT sign-in could not be started.")
	}
	loginURL := authorizeURL + "?" + values.Encode()

	if err := c.openBrowser(operationCtx, loginURL); err != nil {
		if operationCtx.Err() != nil {
			return authorizationContextError(operationCtx)
		}
		return contract.NewError("browser_unavailable", "The system browser could not be opened for ChatGPT sign-in.")
	}
	if waiting != nil {
		waiting()
	}

	var result callbackResult
	select {
	case result = <-callback:
	case <-operationCtx.Done():
		if errors.Is(operationCtx.Err(), context.DeadlineExceeded) {
			return contract.NewError("authorization_timeout", "ChatGPT sign-in timed out.")
		}
		return context.Canceled
	}
	stopCtx, stopCancel := context.WithTimeout(context.Background(), time.Second)
	_ = server.Shutdown(stopCtx)
	stopCancel()
	<-serveDone
	if result.err != nil {
		return result.err
	}
	clientID := result.clientID
	if clientID == "" && returning {
		clientID = old.ClientID
	}
	if !validClientID(clientID) {
		return contract.NewError("registration_incomplete", "ChatGPT did not return a valid issued client ID.")
	}

	config := oauth2.Config{
		ClientID:    clientID,
		RedirectURL: redirectURI,
		Endpoint: oauth2.Endpoint{
			AuthURL:   authorizeURL,
			TokenURL:  tokenURL,
			AuthStyle: oauth2.AuthStyleInParams,
		},
		Scopes: requestedScopes,
	}
	ctxWithHTTP := context.WithValue(operationCtx, oauth2.HTTPClient, c.httpClient)
	token, err := config.Exchange(ctxWithHTTP, result.code, oauth2.VerifierOption(verifier), oauth2.SetAuthURLParam("resource", resourceURL))
	if err != nil {
		if operationCtx.Err() != nil {
			return authorizationContextError(operationCtx)
		}
		return contract.NewError("token_exchange_failed", "ChatGPT sign-in could not be completed. Start sign-in again.")
	}
	idTokenRaw := stringExtra(token, "id_token")
	if token.AccessToken == "" || idTokenRaw == "" || token.ExpiresIn <= 0 || token.Type() != "Bearer" {
		return contract.NewError("token_response_invalid", "ChatGPT returned an incomplete sign-in response.")
	}
	scopeValue := stringExtra(token, "scope")
	scopes := parseScopes(scopeValue)

	keySet := oidc.NewRemoteKeySet(ctxWithHTTP, metadata.JWKSURI)
	verifierOIDC := oidc.NewVerifier(issuerURL, keySet, &oidc.Config{ClientID: clientID, Now: c.now})
	idToken, err := verifierOIDC.Verify(ctxWithHTTP, idTokenRaw)
	if err != nil {
		if operationCtx.Err() != nil {
			return authorizationContextError(operationCtx)
		}
		return contract.NewError("id_token_invalid", "ChatGPT returned an invalid identity token.")
	}
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(nonce)) != 1 || idToken.Subject == "" {
		return contract.NewError("id_token_invalid", "ChatGPT returned an invalid identity token.")
	}
	if returning && old.Subject != "" && old.Subject != idToken.Subject {
		return contract.NewError("account_mismatch", "The signed-in account does not match the selected ChatGPT account.")
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return contract.NewError("id_token_invalid", "ChatGPT returned an invalid identity token.")
	}
	credential := Credential{
		ClientID:     clientID,
		HostID:       hostID,
		Subject:      idToken.Subject,
		Email:        claims.Email,
		IDToken:      idTokenRaw,
		AccessToken:  token.AccessToken,
		RefreshToken: stringExtra(token, "refresh_token"),
		Scopes:       scopes,
		Expiry:       c.now().Add(time.Duration(token.ExpiresIn) * time.Second),
	}
	registration := Registration{
		ClientID: clientID,
		HostID:   hostID,
		Subject:  idToken.Subject,
		Email:    claims.Email,
	}
	tokens := SessionTokens{
		IDToken:      credential.IDToken,
		AccessToken:  credential.AccessToken,
		RefreshToken: credential.RefreshToken,
		Scopes:       credential.Scopes,
		Expiry:       credential.Expiry,
	}
	committed, err := c.store.CommitAuth(operationCtx, snapshot.Generation, registration, tokens)
	if err != nil {
		if operationCtx.Err() != nil {
			return authorizationContextError(operationCtx)
		}
		return credentialStoreError(err)
	}
	if !committed {
		if operationCtx.Err() != nil {
			return authorizationContextError(operationCtx)
		}
		return contract.NewError("session_changed", "The ChatGPT session changed while sign-in was completing. Start sign-in again.")
	}
	if !hasScope(scopes, planUseScope) {
		return contract.NewError("missing_scope", "This ChatGPT account has not granted plan usage.")
	}
	return nil
}

func authorizationContextError(ctx context.Context) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return contract.NewError("authorization_timeout", "ChatGPT sign-in timed out.")
	}
	return context.Canceled
}

func validateCallbackRequest(r *http.Request, expectedHost, state, requestedClientID string, returning bool) callbackResult {
	if r.Method != http.MethodGet || r.URL.Path != callbackPath || r.Host != expectedHost {
		return callbackResult{err: contract.NewError("invalid_callback", "The ChatGPT sign-in callback is invalid.")}
	}
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	remoteIP := net.ParseIP(remoteHost)
	if err != nil || remoteIP == nil || !remoteIP.IsLoopback() {
		return callbackResult{err: contract.NewError("invalid_callback", "The ChatGPT sign-in callback is invalid.")}
	}
	returnedState := r.URL.Query().Get("state")
	if len(returnedState) != len(state) || subtle.ConstantTimeCompare([]byte(returnedState), []byte(state)) != 1 {
		return callbackResult{err: contract.NewError("state_mismatch", "The ChatGPT sign-in callback did not match this request.")}
	}
	if oauthError := r.URL.Query().Get("error"); oauthError != "" {
		if oauthError == "access_denied" {
			return callbackResult{err: contract.NewError("authorization_denied", "ChatGPT sign-in was not approved.")}
		}
		return callbackResult{err: contract.NewError("authorization_failed", "ChatGPT sign-in could not be completed.")}
	}
	code := r.URL.Query().Get("code")
	clientID := r.URL.Query().Get("client_id")
	if code == "" || len(code) > 4096 || strings.TrimSpace(code) != code {
		return callbackResult{err: contract.NewError("invalid_callback", "The ChatGPT sign-in callback is invalid.")}
	}
	if returning {
		if clientID != "" && clientID != requestedClientID {
			return callbackResult{err: contract.NewError("client_id_mismatch", "ChatGPT returned a different client registration.")}
		}
	} else if !validClientID(clientID) {
		return callbackResult{err: contract.NewError("registration_incomplete", "ChatGPT did not return a valid issued client ID.")}
	}
	return callbackResult{code: code, clientID: clientID}
}

func validClientID(value string) bool {
	if len(value) == 0 || len(value) > 256 || value == newClientID || strings.TrimSpace(value) != value {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '_' || char == '-' || char == '.') {
			return false
		}
	}
	return true
}

func randomURLToken(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func stringExtra(token interface{ Extra(string) any }, key string) string {
	value, _ := token.Extra(key).(string)
	return value
}

func (c *Client) postTokenForm(ctx context.Context, form url.Values) (*tokenResponse, error) {
	if !officialHTTPS(tokenURL) {
		return nil, contract.NewError("token_refresh_failed", "The ChatGPT session could not be refreshed.")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, contract.NewError("token_refresh_failed", "The ChatGPT session could not be refreshed.")
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, contract.NewError("token_refresh_failed", "The ChatGPT session could not be refreshed.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, contract.NewError("token_refresh_failed", "The ChatGPT session could not be refreshed.")
	}
	var result tokenResponse
	if err := decodeLimitedJSON(response.Body, maxTokenBodySize, &result); err != nil {
		return nil, contract.NewError("token_refresh_failed", "The ChatGPT session could not be refreshed.")
	}
	return &result, nil
}

func decodeLimitedJSON(reader io.Reader, limit int64, target any) error {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > limit {
		return errors.New("JSON response exceeds size limit")
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("decode JSON response: %w", err)
	}
	return nil
}
