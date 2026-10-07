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
	logoutCtx, cancel := context.WithTimeout(ctx, c.authTimeout)
	defer cancel()

	done, owner := c.beginLogout()
	if !owner {
		select {
		case <-done:
			return false, nil
		case <-logoutCtx.Done():
			return false, nil
		}
	}
	defer c.finishLogout(done)

	// Advance the store generation and clear tokens before cancellation or any
	// network wait. A late login/refresh CAS can no longer restore the session.
	clearCtx, clearCancel := context.WithTimeout(context.Background(), time.Second)
	credential, clearErr := c.store.InvalidateSession(clearCtx)
	clearCancel()
	if clearErr != nil {
		return false, contract.NewError("credential_unavailable", "The local ChatGPT session could not be cleared.")
	}

	c.cancelAndWaitOperations(logoutCtx)
	confirmed := false
	if credential.RefreshToken == "" || logoutCtx.Err() != nil {
		return false, nil
	}
	metadata, err := c.provider(logoutCtx)
	if err != nil || metadata.RevocationEndpoint == "" || !officialHTTPS(metadata.RevocationEndpoint) {
		return false, nil
	}
	form := url.Values{
		"token":           {credential.RefreshToken},
		"token_type_hint": {"refresh_token"},
		"client_id":       {credential.ClientID},
	}
	request, err := http.NewRequestWithContext(logoutCtx, http.MethodPost, metadata.RevocationEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return false, nil
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	type revokeResult struct {
		response *http.Response
		err      error
	}
	revoked := make(chan revokeResult, 1)
	go func() {
		response, err := c.httpClient.Do(request)
		revoked <- revokeResult{response: response, err: err}
	}()
	var result revokeResult
	select {
	case result = <-revoked:
	case <-logoutCtx.Done():
		return false, nil
	}
	if result.err != nil || result.response == nil {
		return false, nil
	}
	_ = result.response.Body.Close()
	confirmed = result.response.StatusCode == http.StatusOK
	return confirmed, nil
}

func (c *Client) beginLogout() (chan struct{}, bool) {
	c.opMu.Lock()
	defer c.opMu.Unlock()
	if c.loggingOut {
		return c.logoutDone, false
	}
	c.loggingOut = true
	c.logoutDone = make(chan struct{})
	return c.logoutDone, true
}

func (c *Client) finishLogout(done chan struct{}) {
	c.opMu.Lock()
	if c.logoutDone == done {
		c.loggingOut = false
		c.logoutDone = nil
		close(done)
	}
	c.opMu.Unlock()
}
