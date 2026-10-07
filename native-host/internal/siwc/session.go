package siwc

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
)

func (c *Client) Logout(ctx context.Context) (bool, error) {
	credential, ok, err := c.store.Load(ctx)
	if err != nil {
		return false, contract.NewError("credential_unavailable", "The local credential store is unavailable.")
	}
	if !ok {
		return true, nil
	}
	confirmed := false
	if credential.RefreshToken != "" {
		metadata, metadataErr := c.provider(ctx)
		if metadataErr == nil && metadata.RevocationEndpoint != "" && officialHTTPS(metadata.RevocationEndpoint) {
			form := url.Values{
				"token":           {credential.RefreshToken},
				"token_type_hint": {"refresh_token"},
				"client_id":       {credential.ClientID},
			}
			request, requestErr := http.NewRequestWithContext(ctx, http.MethodPost, metadata.RevocationEndpoint, strings.NewReader(form.Encode()))
			if requestErr == nil {
				request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
				request.Header.Set("Accept", "application/json")
				response, doErr := c.httpClient.Do(request)
				if doErr == nil {
					_ = response.Body.Close()
					confirmed = response.StatusCode == http.StatusOK
				}
			}
		}
	}
	// Signing out clears the local session even if remote revocation could not be
	// confirmed, as required by the Sign in with ChatGPT session guidance.
	clearCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := c.store.Clear(clearCtx); err != nil {
		return confirmed, contract.NewError("credential_unavailable", "The local ChatGPT session could not be cleared.")
	}
	return confirmed, nil
}
