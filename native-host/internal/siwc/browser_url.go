package siwc

import (
	"errors"
	"net/url"
)

var errInvalidBrowserURL = errors.New("authorization URL is not an official ChatGPT URL")

func validAuthorizeURL(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && parsed.Scheme == "https" && parsed.Host == "auth.openai.com" &&
		parsed.Path == "/api/accounts/authorize" && parsed.User == nil && parsed.Fragment == ""
}
