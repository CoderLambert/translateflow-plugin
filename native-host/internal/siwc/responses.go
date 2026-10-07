package siwc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/CoderLambert/translateflow-plugin/native-host/internal/contract"
)

const (
	maxModelsBodyBytes = 2 << 20
	maxStreamBodyBytes = 4 << 20
	maxErrorBodyBytes  = 64 << 10
	maxSSELineBytes    = 256 << 10
	maxOutputBytes     = 128 << 10
	maxModelsToReturn  = 256
)

type responsesRequest struct {
	Model        string         `json:"model"`
	Instructions string         `json:"instructions,omitempty"`
	Input        []responseItem `json:"input"`
	Store        bool           `json:"store"`
	Stream       bool           `json:"stream"`
}

type responseItem struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type responseEvent struct {
	Type     string `json:"type"`
	Delta    string `json:"delta"`
	Code     string `json:"code"`
	Response struct {
		Error *responsesError `json:"error"`
	} `json:"response"`
}

type responsesError struct {
	Code string `json:"code"`
}

type responsesErrorEnvelope struct {
	Error *responsesError `json:"error"`
}

var responsesErrorCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,95}$`)

func (c *Client) ListModels(ctx context.Context) ([]contract.Model, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	operationCtx, finish, err := c.beginOperation(requestCtx)
	if err != nil {
		return nil, err
	}
	defer finish()
	credential, err := c.credentialForUse(operationCtx)
	if err != nil {
		return nil, err
	}
	if !officialAPIURL(modelsURL) {
		return nil, contract.NewError("api_target_invalid", "The ChatGPT model endpoint is invalid.")
	}
	request, err := http.NewRequestWithContext(operationCtx, http.MethodGet, modelsURL, nil)
	if err != nil {
		return nil, contract.NewError("models_unavailable", "ChatGPT models could not be loaded.")
	}
	request.Header.Set("Authorization", "Bearer "+credential.AccessToken)
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		if operationCtx.Err() != nil {
			return nil, context.Canceled
		}
		return nil, contract.NewError("models_unavailable", "ChatGPT models could not be loaded.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, contract.NewError("models_unavailable", "ChatGPT models could not be loaded.")
	}
	mediaType, _, mediaErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if mediaErr != nil || (mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) {
		return nil, contract.NewError("models_response_invalid", "ChatGPT returned an invalid model list.")
	}
	var result struct {
		Models []struct {
			Visibility  string `json:"visibility"`
			Slug        string `json:"slug"`
			DisplayName string `json:"display_name"`
		} `json:"models"`
	}
	if err := decodeLimitedJSON(response.Body, maxModelsBodyBytes, &result); err != nil {
		if operationCtx.Err() != nil {
			return nil, context.Canceled
		}
		return nil, contract.NewError("models_response_invalid", "ChatGPT returned an invalid model list.")
	}
	models := make([]contract.Model, 0, len(result.Models))
	for _, model := range result.Models {
		if model.Visibility != "list" || model.Slug == "" || len(model.Slug) > 128 || len(model.DisplayName) > 256 {
			continue
		}
		models = append(models, contract.Model{Slug: model.Slug, DisplayName: model.DisplayName})
		if len(models) >= maxModelsToReturn {
			break
		}
	}
	return models, nil
}

func (c *Client) Infer(ctx context.Context, input contract.InferenceRequest, onDelta func(string) error) (contract.InferenceResult, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	operationCtx, finish, err := c.beginOperation(requestCtx)
	if err != nil {
		return contract.InferenceResult{}, err
	}
	defer finish()
	if input.Model == "" || len(input.Model) > 128 || len(input.Instructions) > 16*1024 || input.Input == "" || len(input.Input) > 64*1024 {
		return contract.InferenceResult{}, contract.NewError("invalid_payload", "The inference request is invalid or exceeds its size limit.")
	}
	credential, err := c.credentialForUse(operationCtx)
	if err != nil {
		return contract.InferenceResult{}, err
	}
	if !officialAPIURL(responsesURL) {
		return contract.InferenceResult{}, contract.NewError("api_target_invalid", "The ChatGPT inference endpoint is invalid.")
	}
	body := responsesRequest{
		Model:        input.Model,
		Instructions: input.Instructions,
		Input: []responseItem{{
			Role:    "user",
			Content: input.Input,
		}},
		Store:  false,
		Stream: true,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return contract.InferenceResult{}, contract.NewError("invalid_payload", "The inference request is invalid.")
	}
	request, err := http.NewRequestWithContext(operationCtx, http.MethodPost, responsesURL, bytes.NewReader(encoded))
	if err != nil {
		return contract.InferenceResult{}, contract.NewError("inference_unavailable", "ChatGPT inference could not be started.")
	}
	request.Header.Set("Authorization", "Bearer "+credential.AccessToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	response, err := c.httpClient.Do(request)
	if err != nil {
		if operationCtx.Err() != nil {
			return contract.InferenceResult{}, inferenceContextError(operationCtx)
		}
		return contract.InferenceResult{}, contract.NewError("inference_unavailable", "ChatGPT inference could not be started.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		responseErr := responseHTTPError(response.StatusCode, response.Body)
		if operationCtx.Err() != nil {
			return contract.InferenceResult{}, inferenceContextError(operationCtx)
		}
		return contract.InferenceResult{}, responseErr
	}
	limited := &io.LimitedReader{R: response.Body, N: maxStreamBodyBytes + 1}
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 4096), maxSSELineBytes)
	var dataLines []string
	var output strings.Builder
	completed := false
	process := func() error {
		if len(dataLines) == 0 {
			return nil
		}
		data := strings.Join(dataLines, "\n")
		dataLines = dataLines[:0]
		if data == "[DONE]" {
			return nil
		}
		var event responseEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return contract.NewError("stream_event_invalid", "ChatGPT returned an invalid response stream event.")
		}
		switch event.Type {
		case "response.output_text.delta":
			if output.Len()+len(event.Delta) > maxOutputBytes {
				return contract.NewError("output_too_large", "ChatGPT's response exceeded the size limit.")
			}
			output.WriteString(event.Delta)
			if onDelta != nil && event.Delta != "" {
				if err := onDelta(event.Delta); err != nil {
					return err
				}
			}
		case "response.completed":
			completed = true
		case "response.failed":
			if event.Response.Error != nil {
				return responseStreamError(event.Response.Error.Code)
			}
			return contract.NewError("inference_failed", "ChatGPT reported that the response failed.")
		case "response.incomplete":
			return contract.NewError("inference_incomplete", "ChatGPT returned an incomplete response.")
		case "error":
			return responseStreamError(event.Code)
		}
		return nil
	}

	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := process(); err != nil {
				if operationCtx.Err() != nil {
					return contract.InferenceResult{}, inferenceContextError(operationCtx)
				}
				return contract.InferenceResult{}, err
			}
			if completed {
				break
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		if strings.HasPrefix(line, "data:") {
			value := strings.TrimPrefix(line, "data:")
			dataLines = append(dataLines, strings.TrimLeft(value, " \t"))
		}
	}
	if !completed && len(dataLines) > 0 {
		if err := process(); err != nil {
			if operationCtx.Err() != nil {
				return contract.InferenceResult{}, inferenceContextError(operationCtx)
			}
			return contract.InferenceResult{}, err
		}
	}
	if operationCtx.Err() != nil {
		return contract.InferenceResult{}, inferenceContextError(operationCtx)
	}
	if scanner.Err() != nil {
		if errors.Is(scanner.Err(), context.Canceled) || operationCtx.Err() != nil {
			return contract.InferenceResult{}, inferenceContextError(operationCtx)
		}
		return contract.InferenceResult{}, contract.NewError("stream_failed", "The ChatGPT response stream was interrupted.")
	}
	if limited.N == 0 {
		return contract.InferenceResult{}, contract.NewError("stream_too_large", "The ChatGPT response stream exceeded the size limit.")
	}
	if !completed {
		return contract.InferenceResult{}, contract.NewError("stream_incomplete", "The ChatGPT response stream ended before completion.")
	}
	return contract.InferenceResult{Text: output.String()}, nil
}

func responseHTTPError(status int, body io.Reader) error {
	code := responseEnvelopeErrorCode(body)
	if safeResponsesErrorCode(code) {
		return contract.NewError(code, "ChatGPT rejected the inference request.")
	}
	return contract.NewError(fmt.Sprintf("inference_http_%d", status), "ChatGPT inference could not be completed.")
}

func responseEnvelopeErrorCode(body io.Reader) string {
	limited := io.LimitReader(body, maxErrorBodyBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil || len(data) > maxErrorBodyBytes {
		return ""
	}
	var envelope responsesErrorEnvelope
	if json.Unmarshal(data, &envelope) != nil || envelope.Error == nil {
		return ""
	}
	return envelope.Error.Code
}

func responseStreamError(code string) error {
	if safeResponsesErrorCode(code) {
		return contract.NewError(code, "ChatGPT reported that the response failed.")
	}
	return contract.NewError("inference_failed", "ChatGPT reported that the response failed.")
}

func safeResponsesErrorCode(code string) bool {
	return responsesErrorCodePattern.MatchString(code)
}

func inferenceContextError(ctx context.Context) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return contract.NewError("inference_timeout", "ChatGPT inference exceeded the time limit.")
	}
	return context.Canceled
}

func officialAPIURL(raw string) bool {
	request, err := http.NewRequest(http.MethodGet, raw, nil)
	return err == nil && request.URL.Scheme == "https" && request.URL.Host == "api.openai.com" && request.URL.User == nil
}
