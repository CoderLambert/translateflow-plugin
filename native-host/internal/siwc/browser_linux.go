//go:build linux

package siwc

import (
	"context"
	"io"
	"os/exec"
)

func openSystemBrowser(ctx context.Context, raw string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validAuthorizeURL(raw) {
		return errInvalidBrowserURL
	}
	command := exec.Command("xdg-open", raw)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}
