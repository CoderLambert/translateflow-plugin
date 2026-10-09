//go:build !linux && !windows

package installer

import (
	"fmt"
	"io"
)

func Install(string, string, string, bool, io.Writer) error {
	return fmt.Errorf("native host installation is currently supported only for Google Chrome on Windows and Linux")
}

func Uninstall(string, bool, io.Writer) error {
	return fmt.Errorf("native host installation is currently supported only for Google Chrome on Windows and Linux")
}
