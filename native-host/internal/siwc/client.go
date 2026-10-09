package siwc

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
)

const (
	issuerURL       = "https://auth.openai.com"
	authorizeURL    = "https://auth.openai.com/api/accounts/authorize"
	tokenURL        = "https://auth.openai.com/api/accounts/oauth/token"
	resourceURL     = "https://api.openai.com/v1"
	modelsURL       = "https://api.openai.com/v1/models"
	responsesURL    = "https://api.openai.com/v1/responses"
	newClientID     = "dynamic_agent_client"
	planUseScope    = "chatgpt.tokens.use.direct"
	maxMetadataSize = 128 << 10
)

var requestedScopes = []string{"openid", "profile", "email", "offline_access", "resource.invoke", planUseScope}

type Options struct {
	AgentName   string
	Store       CredentialStore
	HTTPClient  *http.Client
	OpenBrowser func(context.Context, string) error
	Now         func() time.Time
	AuthTimeout time.Duration
}

type Client struct {
	agentName   string
	store       CredentialStore
	httpClient  *http.Client
	openBrowser func(context.Context, string) error
	now         func() time.Time
	authTimeout time.Duration
	hostID      string
	opMu        sync.Mutex
	loggingOut  bool
	logoutDone  chan struct{}
	nextOpID    uint64
	operations  map[uint64]clientOperation
}

type clientOperation struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func New(options Options) (*Client, error) {
	name := strings.TrimSpace(options.AgentName)
	if name == "" || len(name) > 80 {
		return nil, errors.New("a fixed agent name is required")
	}
	if options.Store == nil {
		return nil, errors.New("a credential store is required")
	}
	hostID, err := randomHostID()
	if err != nil {
		return nil, err
	}
	if options.HTTPClient == nil {
		options.HTTPClient = &http.Client{
			Transport: &http.Transport{
				Proxy:                  http.ProxyFromEnvironment,
				DialContext:            (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
				TLSHandshakeTimeout:    10 * time.Second,
				ResponseHeaderTimeout:  30 * time.Second,
				IdleConnTimeout:        90 * time.Second,
				MaxIdleConns:           8,
				MaxConnsPerHost:        4,
				MaxResponseHeaderBytes: 64 << 10,
			},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
	}
	if options.OpenBrowser == nil {
		options.OpenBrowser = openSystemBrowser
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.AuthTimeout <= 0 {
		options.AuthTimeout = 5 * time.Minute
	}
	return &Client{
		agentName:   name,
		store:       options.Store,
		httpClient:  options.HTTPClient,
		openBrowser: options.OpenBrowser,
		now:         options.Now,
		authTimeout: options.AuthTimeout,
		hostID:      hostID,
		operations:  make(map[uint64]clientOperation),
	}, nil
}

func (c *Client) AuthStatus(ctx context.Context) (contract.AuthStatus, error) {
	snapshot, err := c.store.Snapshot(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return contract.AuthStatus{}, context.Canceled
		}
		return contract.AuthStatus{}, credentialStoreError(err)
	}
	accounts, activeAccount, err := c.store.Accounts(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return contract.AuthStatus{}, context.Canceled
		}
		return contract.AuthStatus{}, credentialStoreError(err)
	}
	status := contract.AuthStatus{Storage: credentialStorageName(c.store), ActiveAccount: activeAccount,
		Accounts: make([]contract.Account, 0, len(accounts))}
	for _, account := range accounts {
		status.Accounts = append(status.Accounts, contract.Account{ID: account.ID, Label: account.Label,
			Email: account.Email, Connected: account.Connected})
	}
	if !snapshot.HasSession {
		return status, nil
	}
	status.Connected = true
	expiresAt := snapshot.Tokens.Expiry
	status.ExpiresAt = &expiresAt
	status.CanInfer = hasScope(snapshot.Tokens.Scopes, planUseScope) &&
		(snapshot.Tokens.Expiry.After(c.now()) || snapshot.Tokens.RefreshToken != "")
	return status, nil
}

func (c *Client) SelectAccount(ctx context.Context, accountID string) error {
	if accountID == "" || len(accountID) > 128 {
		return contract.NewError("invalid_account", "Select a valid saved ChatGPT account.")
	}
	done, owner := c.beginLogout()
	if !owner {
		select {
		case <-done:
			return contract.NewError("session_changed", "The selected ChatGPT account changed. Try again.")
		case <-ctx.Done():
			return context.Canceled
		}
	}
	defer c.finishLogout(done)
	c.cancelAndWaitOperations(ctx)
	if err := c.store.SelectAccount(ctx, accountID); err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			return contract.NewError("account_not_found", "The selected ChatGPT account is no longer available.")
		}
		if ctx.Err() != nil {
			return context.Canceled
		}
		return credentialStoreError(err)
	}
	return nil
}

func (c *Client) credentialForUse(ctx context.Context) (Credential, error) {
	unlock, err := c.store.AcquireRefreshLock(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return Credential{}, context.Canceled
		}
		return Credential{}, credentialStoreError(err)
	}
	defer unlock()
	snapshot, err := c.store.Snapshot(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return Credential{}, context.Canceled
		}
		return Credential{}, credentialStoreError(err)
	}
	if !snapshot.HasSession {
		return Credential{}, contract.NewError("not_signed_in", "Sign in with ChatGPT before using this action.")
	}
	if !hasScope(snapshot.Tokens.Scopes, planUseScope) {
		return Credential{}, contract.NewError("missing_scope", "This ChatGPT account has not granted plan usage.")
	}
	credential := snapshot.credential()
	if credential.AccessToken != "" && credential.Expiry.After(c.now().Add(30*time.Second)) {
		return credential, nil
	}
	if snapshot.Tokens.RefreshToken == "" {
		if credential.AccessToken == "" {
			return Credential{}, contract.NewError("token_unavailable", "The ChatGPT access token is unavailable.")
		}
		return Credential{}, contract.NewError("token_expired", "The ChatGPT session has expired. Sign in again.")
	}
	refreshed, err := c.refresh(ctx, snapshot)
	if err != nil {
		return Credential{}, err
	}
	return refreshed, nil
}

func credentialStorageName(store CredentialStore) string {
	if named, ok := store.(interface{ StorageName() string }); ok {
		return named.StorageName()
	}
	return "system-secure"
}

func credentialStoreError(err error) error {
	if errors.Is(err, ErrCredentialRecordInvalid) {
		return contract.NewError("credential_invalid", "Saved ChatGPT credential data is invalid. Restore or remove that secure-store item, then sign in again.")
	}
	if errors.Is(err, ErrSecureStoreLocked) {
		if runtime.GOOS == "linux" {
			return contract.NewError("credential_locked", "The Linux Secret Service is locked or requires an interactive prompt. Unlock a compatible Secret Service provider in your current user session, then retry; TranslateFlow will not unlock it automatically.")
		}
		return contract.NewError("credential_locked", "Unlock the system credential store, then try again.")
	}
	if runtime.GOOS == "linux" {
		return contract.NewError("credential_unavailable", "TranslateFlow could not reach a compatible Secret Service on the current user's session D-Bus. Check that this session has DBUS_SESSION_BUS_ADDRESS and that a Secret Service provider is running; TranslateFlow will not install or unlock one automatically.")
	}
	return contract.NewError("credential_unavailable", "The system secure store is unavailable or locked. Unlock it and retry.")
}

func (c *Client) refresh(ctx context.Context, snapshot CredentialSnapshot) (Credential, error) {
	credential := snapshot.credential()
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {credential.ClientID},
		"refresh_token": {credential.RefreshToken},
		"resource":      {resourceURL},
	}
	response, err := c.postTokenForm(ctx, form)
	if err != nil {
		if ctx.Err() != nil {
			return Credential{}, context.Canceled
		}
		return Credential{}, err
	}
	if response.AccessToken == "" || response.ExpiresIn <= 0 || !strings.EqualFold(response.TokenType, "Bearer") {
		return Credential{}, contract.NewError("token_refresh_failed", "The ChatGPT session could not be refreshed.")
	}
	tokens := snapshot.Tokens
	tokens.AccessToken = response.AccessToken
	if response.RefreshToken != "" {
		tokens.RefreshToken = response.RefreshToken
	}
	if response.Scope != "" {
		tokens.Scopes = parseScopes(response.Scope)
	}
	tokens.Expiry = c.now().Add(time.Duration(response.ExpiresIn) * time.Second)
	committed, err := c.store.CommitRefresh(ctx, snapshot.Generation, tokens)
	if err != nil {
		if ctx.Err() != nil {
			return Credential{}, context.Canceled
		}
		return Credential{}, credentialStoreError(err)
	}
	if !committed {
		if ctx.Err() != nil {
			return Credential{}, context.Canceled
		}
		return Credential{}, contract.NewError("session_changed", "The ChatGPT session changed while it was being refreshed. Sign in again.")
	}
	credential.AccessToken = tokens.AccessToken
	credential.RefreshToken = tokens.RefreshToken
	credential.Scopes = append([]string(nil), tokens.Scopes...)
	credential.Expiry = tokens.Expiry
	if !hasScope(tokens.Scopes, planUseScope) {
		return Credential{}, contract.NewError("missing_scope", "The refreshed ChatGPT session does not grant plan usage.")
	}
	return credential, nil
}

func (c *Client) beginOperation(parent context.Context) (context.Context, func(), error) {
	ctx, cancel := context.WithCancel(parent)
	c.opMu.Lock()
	if c.loggingOut {
		c.opMu.Unlock()
		cancel()
		return nil, nil, contract.NewError("signing_out", "The ChatGPT session is signing out. Try again shortly.")
	}
	c.nextOpID++
	id := c.nextOpID
	operation := clientOperation{cancel: cancel, done: make(chan struct{})}
	c.operations[id] = operation
	c.opMu.Unlock()
	finish := func() {
		cancel()
		c.opMu.Lock()
		delete(c.operations, id)
		close(operation.done)
		c.opMu.Unlock()
	}
	return ctx, finish, nil
}

func (c *Client) cancelAndWaitOperations(ctx context.Context) {
	c.opMu.Lock()
	operations := make([]clientOperation, 0, len(c.operations))
	for _, operation := range c.operations {
		operations = append(operations, operation)
	}
	c.opMu.Unlock()
	for _, operation := range operations {
		operation.cancel()
	}
	for _, operation := range operations {
		select {
		case <-operation.done:
		case <-ctx.Done():
			return
		}
	}
}

func (c *Client) provider(ctx context.Context) (*providerInfo, error) {
	metadata, err := c.readMetadata(ctx)
	if err != nil {
		return nil, err
	}
	if metadata.Issuer != issuerURL || !officialHTTPS(metadata.AuthorizationEndpoint) ||
		metadata.TokenEndpoint != tokenURL || !officialHTTPS(metadata.JWKSURI) ||
		(metadata.RevocationEndpoint != "" && !officialHTTPS(metadata.RevocationEndpoint)) {
		return nil, contract.NewError("auth_metadata_invalid", "The official ChatGPT authentication metadata is invalid.")
	}
	return metadata, nil
}

func (c *Client) readMetadata(ctx context.Context) (*providerInfo, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, issuerURL+"/.well-known/openid-configuration", nil)
	if err != nil {
		return nil, contract.NewError("auth_metadata_unavailable", "ChatGPT authentication metadata is unavailable.")
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, contract.NewError("auth_metadata_unavailable", "ChatGPT authentication metadata is unavailable.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, contract.NewError("auth_metadata_unavailable", "ChatGPT authentication metadata is unavailable.")
	}
	var metadata providerInfo
	if err := decodeLimitedJSON(response.Body, maxMetadataSize, &metadata); err != nil {
		return nil, contract.NewError("auth_metadata_invalid", "The official ChatGPT authentication metadata is invalid.")
	}
	return &metadata, nil
}

type providerInfo struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
	RevocationEndpoint    string `json:"revocation_endpoint"`
}

func officialHTTPS(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && parsed.Scheme == "https" && parsed.Host == "auth.openai.com" &&
		parsed.User == nil && parsed.Fragment == ""
}

func randomHostID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(value[:])
	return fmt.Sprintf("urn:uuid:%s-%s-%s-%s-%s", encoded[0:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:32]), nil
}

func parseScopes(raw string) []string {
	parts := strings.Fields(raw)
	seen := make(map[string]struct{}, len(parts))
	scopes := make([]string, 0, len(parts))
	for _, scope := range parts {
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		scopes = append(scopes, scope)
	}
	return scopes
}

func hasScope(scopes []string, value string) bool {
	for _, scope := range scopes {
		if subtle.ConstantTimeCompare([]byte(scope), []byte(value)) == 1 {
			return true
		}
	}
	return false
}
