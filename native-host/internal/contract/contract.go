package contract

import (
	"context"
	"time"
)

type AuthStatus struct {
	Connected bool       `json:"connected"`
	CanInfer  bool       `json:"canInfer"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	Storage   string     `json:"storage"`
}

type Model struct {
	Slug        string `json:"slug"`
	DisplayName string `json:"displayName"`
}

type InferenceRequest struct {
	Model        string `json:"model"`
	Instructions string `json:"instructions"`
	Input        string `json:"input"`
}

type InferenceResult struct {
	Text string `json:"text"`
}

type Backend interface {
	AuthStatus(context.Context) (AuthStatus, error)
	StartAuth(context.Context, func()) error
	Logout(context.Context) (revocationConfirmed bool, err error)
	ListModels(context.Context) ([]Model, error)
	Infer(context.Context, InferenceRequest, func(string) error) (InferenceResult, error)
}

type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

func NewError(code, message string) error { return &Error{Code: code, Message: message} }
