package protocol

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"
)

type byteReader struct{ reader *bytes.Reader }

func (r byteReader) Read(buffer []byte) (int, error) {
	if len(buffer) > 1 {
		buffer = buffer[:1]
	}
	return r.reader.Read(buffer)
}

func TestReadFrameAcceptsFragmentedLengthPrefix(t *testing.T) {
	written := new(bytes.Buffer)
	want := []byte(`{"type":"request"}`)
	if err := WriteFrame(written, want, MaxFrameBytes); err != nil {
		t.Fatal(err)
	}
	got, err := ReadFrame(byteReader{reader: bytes.NewReader(written.Bytes())}, MaxFrameBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("ReadFrame() = %q, want %q", got, want)
	}
	if binary.LittleEndian.Uint32(written.Bytes()[:4]) != uint32(len(want)) {
		t.Fatal("frame header is not a little-endian payload byte length")
	}
}

func TestReadFrameRejectsEmptyOversizedAndTruncatedFrames(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		max  uint32
		want error
	}{
		{name: "empty", data: []byte{0, 0, 0, 0}, max: 10},
		{name: "oversized", data: []byte{11, 0, 0, 0}, max: 10, want: ErrFrameTooLarge},
		{name: "truncated header", data: []byte{1}, max: 10, want: io.ErrUnexpectedEOF},
		{name: "truncated body", data: []byte{2, 0, 0, 0, 'x'}, max: 10, want: io.ErrUnexpectedEOF},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ReadFrame(bytes.NewReader(test.data), test.max)
			if err == nil {
				t.Fatal("ReadFrame() succeeded, want an error")
			}
			if test.want != nil && !errors.Is(err, test.want) {
				t.Fatalf("ReadFrame() error = %v, want errors.Is(_, %v)", err, test.want)
			}
		})
	}
}
