//go:build !linux && !windows

package siwc

import (
	"context"
	"errors"
)

func openSystemBrowser(context.Context, string) error {
	return errors.New("system browser opening is not supported on this platform")
}
