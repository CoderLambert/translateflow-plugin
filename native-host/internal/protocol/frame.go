package protocol

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

const MaxFrameBytes = 1 << 20

var ErrFrameTooLarge = errors.New("native messaging frame too large")

func ReadFrame(r io.Reader, max uint32) ([]byte, error) {
	if max == 0 {
		return nil, errors.New("maximum frame size must be positive")
	}
	var header [4]byte
	n, err := io.ReadFull(r, header[:])
	if err != nil {
		if err == io.EOF && n == 0 {
			return nil, io.EOF
		}
		return nil, fmt.Errorf("read native messaging frame header: %w", err)
	}
	size := binary.LittleEndian.Uint32(header[:])
	if size == 0 {
		return nil, errors.New("empty native messaging frame")
	}
	if size > max {
		return nil, ErrFrameTooLarge
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, fmt.Errorf("read native messaging frame body: %w", err)
	}
	return data, nil
}

func WriteFrame(w io.Writer, data []byte, max uint32) error {
	if len(data) == 0 {
		return errors.New("empty native messaging frame")
	}
	if uint64(len(data)) > uint64(max) || uint64(len(data)) > uint64(^uint32(0)) {
		return ErrFrameTooLarge
	}
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(data)))
	if err := writeAll(w, header[:]); err != nil {
		return fmt.Errorf("write native messaging frame header: %w", err)
	}
	if err := writeAll(w, data); err != nil {
		return fmt.Errorf("write native messaging frame body: %w", err)
	}
	return nil
}

func writeAll(w io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := w.Write(data)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}
