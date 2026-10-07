# TranslateFlow ChatGPT Native Messaging Host (candidate)

This is an isolated Go candidate for the ChatGPT plan provider. It is not wired
into the extension, does not add a native-host manifest, and does not perform
client registration or sign-in unless a caller explicitly sends `auth.start`.
The executable uses current-user OS credential storage so a later host process
can restore the session. Linux stores the protected record in Secret Service;
Windows encrypts it with current-user DPAPI and writes only ciphertext under the
user config directory. If the secure store is locked or unavailable, operations
return a recoverable error and never fall back to plaintext. Other platforms
report secure storage as unavailable.
Only one host process may use a user's store at a time. A second process returns
one `HOST_BUSY` terminal before dispatching auth, models, or inference. On Linux,
Secret Service calls use a five-second context deadline; the adapter checks the
collection/item lock state and does not call `Unlock` or `Prompt`. Windows
ciphertext replacement uses `MoveFileEx` with replace-existing and write-through
flags; Windows runtime behavior remains untested.

## Build and run tests

From this directory, with Go 1.26 or later:

```sh
go test ./...
GOOS=linux GOARCH=amd64 go build -o /tmp/translateflow-host-linux ./cmd/translateflow-host
GOOS=windows GOARCH=amd64 go build -o /tmp/translateflow-host-windows.exe ./cmd/translateflow-host
```

The runtime has no Node.js or Python dependency. Direct Go modules provide OIDC
verification, OAuth PKCE, process-safe file locks, Linux D-Bus Secret Service
access, and Windows system calls. Tests use an in-process fake HTTP server and
a fake secure-blob store; store recreation and refresh contention tests are
in-process simulations. A separate helper-subprocess test exercises the host
lock's competition and release. Tests never contact OpenAI or the actual OS
credential store.

## Native messaging protocol

Each message is UTF-8 JSON preceded by a four-byte little-endian byte length.
The host accepts at most 1 MiB per frame, four concurrent work requests, and one
inference at a time. Two separately bounded control slots serve `cancel` and
`auth.logout` even while all work slots are occupied. Inputs are bounded to
64 KiB and instructions to 16 KiB;
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

Registration identity is stored separately from session tokens. Logout advances
the session generation and clears tokens before waiting on remote revocation;
the issued client ID, subject, and host ID remain available for reauthorization.
Refreshes are serialized across host processes, re-read the latest expiry after
acquiring the refresh lock, and use generation-checked commits so an in-flight
refresh or callback cannot restore a session after logout. Credential updates
and logout are serialized by a separate state lock. Corrupt secure-store records
are surfaced as errors instead of being silently reset. The complete sign-in
and sign-out flow is bounded by the configured authentication timeout.

## Future extension connection owner

When the extension is integrated, the MV3 background service worker must be the
sole owner of `chrome.runtime.connectNative` and the native host port. Popup,
Options, Content, and other extension callers should send validated runtime
messages to that owner; it forwards requests over the shared port and correlates
`requestId` and sequence frames. They must not open separate native host
connections. The single-owner extension bridge is a follow-up; this isolated
candidate only enforces the host-process side of the boundary.

Responses requests set `store:false` and `stream:true`. A response succeeds only
after `response.completed`; failed, incomplete, cancelled, or interrupted
streams produce an error terminal. Logs go to stderr and do not include tokens,
authorization codes, prompts, or generated text. The supported request fields
are intentionally limited to model, instructions, and one bounded text input;
there are no Responses tools or API-key fallback.

The registered-account entitlement and model availability depend on the user's
account/workspace. They cannot be established by offline tests. Actual DPAPI,
Secret Service, Windows replacement, live account, credential, registration,
and inference paths were not run for this candidate.

## Official contract references

Checked 2026-10-07:

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
