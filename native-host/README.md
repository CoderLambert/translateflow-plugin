# TranslateFlow ChatGPT Native Messaging Host (candidate)

This is an isolated Go candidate for the ChatGPT plan provider. It is not wired
into the extension, does not add a native-host manifest, and does not perform
client registration or sign-in unless a caller explicitly sends `auth.start`.
The executable keeps credentials in process memory only; there is no plaintext
credential-file fallback. OS credential storage and installer/manifest work are
separate follow-up tasks.

## Build and run tests

From this directory, with Go 1.26 or later:

```sh
go test ./...
GOOS=linux GOARCH=amd64 go build -o /tmp/translateflow-host-linux ./cmd/translateflow-host
GOOS=windows GOARCH=amd64 go build -o /tmp/translateflow-host-windows.exe ./cmd/translateflow-host
```

The runtime has no Node.js or Python dependency. The direct Go modules are
`github.com/coreos/go-oidc/v3` for OIDC discovery and ID-token verification and
`golang.org/x/oauth2` for authorization-code PKCE exchange. Tests use an
in-process fake HTTP server and never contact OpenAI.

## Native messaging protocol

Each message is UTF-8 JSON preceded by a four-byte little-endian byte length.
The host accepts at most 1 MiB per frame, four concurrent requests, and one
inference at a time. Inputs are bounded to 64 KiB and instructions to 16 KiB;
model responses are capped at 256 entries and generated text at 128 KiB. A
request is:

```json
{"type":"request","requestId":"r1","method":"hello","payload":{}}
```

Supported methods are `hello`, `auth.status`, `auth.start`, `auth.logout`,
`models.list`, `infer.start`, and `cancel`. `infer.start` emits sequenced
`event` frames for text deltas and exactly one `terminal` frame for its result.
All request IDs must be unique while active. Unknown fields and methods are
rejected. There is no arbitrary URL, shell-command, file-path, or tool-call
interface.

## SIWC boundaries

Authorization uses the official `auth.openai.com` endpoints, a short-lived
`127.0.0.1` callback at `/auth/callback`, fresh `state` / OIDC `nonce` / PKCE
S256 values, and the official issued-client-ID exchange. Returning sign-in
reuses that issued ID. ID tokens are checked with the official OIDC issuer,
audience, signature, expiry, and nonce; inference requires the granted
`chatgpt.tokens.use.direct` scope. Model discovery and inference use only
`api.openai.com/v1/models` and `/v1/responses`.

Responses requests set `store:false` and `stream:true`. A response succeeds only
after `response.completed`; failed, incomplete, cancelled, or interrupted
streams produce an error terminal. Logs go to stderr and do not include tokens,
authorization codes, prompts, or generated text. The supported request fields
are intentionally limited to model, instructions, and one bounded text input;
there are no Responses tools or API-key fallback.

The registered-account entitlement and model availability depend on the user's
account/workspace. They cannot be established by offline tests. No live account,
credential, registration, or inference was used for this candidate.

## Official contract references

Checked 2026-10-07:

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
