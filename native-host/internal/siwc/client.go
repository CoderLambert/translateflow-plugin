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
	"strings"
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
	}, nil
}

func (c *Client) AuthStatus(ctx context.Context) (contract.AuthStatus, error) {
	credential, ok, err := c.store.Load(ctx)
	if err != nil {
		return contract.AuthStatus{}, contract.NewError("credential_unavailable", "The local credential store is unavailable.")
	}
	status := contract.AuthStatus{Storage: "process-memory"}
	if !ok {
		return status, nil
	}
	status.Connected = true
	status.ExpiresAt = &credential.Expiry
	status.CanInfer = hasScope(credential.Scopes, planUseScope) &&
		(credential.Expiry.After(c.now()) || credential.RefreshToken != "")
	return status, nil
}

func (c *Client) credentialForUse(ctx context.Context) (Credential, error) {
	credential, ok, err := c.store.Load(ctx)
	if err != nil {
		return Credential{}, contract.NewError("credential_unavailable", "The local credential store is unavailable.")
	}
	if !ok {
		return Credential{}, contract.NewError("not_signed_in", "Sign in with ChatGPT before using this action.")
	}
	if !hasScope(credential.Scopes, planUseScope) {
		return Credential{}, contract.NewError("missing_scope", "This ChatGPT account has not granted plan usage.")
	}
	if credential.AccessToken != "" && credential.Expiry.After(c.now().Add(30*time.Second)) {
		return credential, nil
	}
	if credential.RefreshToken == "" {
		if credential.AccessToken == "" {
			return Credential{}, contract.NewError("token_unavailable", "The ChatGPT access token is unavailable.")
		}
		return Credential{}, contract.NewError("token_expired", "The ChatGPT session has expired. Sign in again.")
	}
	refreshed, err := c.refresh(ctx, credential)
	if err != nil {
		return Credential{}, err
	}
	return refreshed, nil
}

func (c *Client) refresh(ctx context.Context, credential Credential) (Credential, error) {
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {credential.ClientID},
		"refresh_token": {credential.RefreshToken},
		"resource":      {resourceURL},
	}
	response, err := c.postTokenForm(ctx, form)
	if err != nil {
		return Credential{}, err
	}
	if response.AccessToken == "" || response.ExpiresIn <= 0 || !strings.EqualFold(response.TokenType, "Bearer") {
		return Credential{}, contract.NewError("token_refresh_failed", "The ChatGPT session could not be refreshed.")
	}
	credential.AccessToken = response.AccessToken
	if response.RefreshToken != "" {
		credential.RefreshToken = response.RefreshToken
	}
	if response.Scope != "" {
		credential.Scopes = parseScopes(response.Scope)
	}
	credential.Expiry = c.now().Add(time.Duration(response.ExpiresIn) * time.Second)
	if err := c.store.Save(ctx, credential); err != nil {
		return Credential{}, contract.NewError("credential_unavailable", "The refreshed session could not be saved.")
	}
	if !hasScope(credential.Scopes, planUseScope) {
		return Credential{}, contract.NewError("missing_scope", "The refreshed ChatGPT session does not grant plan usage.")
	}
	return credential, nil
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
