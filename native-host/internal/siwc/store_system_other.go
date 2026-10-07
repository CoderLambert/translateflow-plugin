//go:build !linux && !windows

package siwc

import "errors"

func newSystemSecureBlobStore(string) (SecureBlobStore, error) {
	return nil, errors.New("system credential storage is unsupported on this platform")
}
