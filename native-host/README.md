# TranslateFlow ChatGPT Native Messaging Host (candidate)

This Go candidate implements the ChatGPT plan provider's Native Messaging
host, a current-user install/uninstall command, and the extension background
service worker client bridge. The root extension `manifest.json` declares
`nativeMessaging`, but the release extension ID is not pinned here. A local
development install must use the ID shown by the browser and separately
register the host for that ID. No host install or OAuth operation was run as
part of these offline checks. Client registration and sign-in start only after
an explicit `auth.start` request.

The executable uses current-user OS credential storage so a later host process
can restore the session. Linux stores the protected record in Secret Service
over the current session D-Bus; Windows encrypts it with current-user DPAPI and
writes only ciphertext under the user config directory. Linux reports locked
and unavailable D-Bus/Secret Service states separately. On Omarchy/Hyprland, a
compatible Secret Service provider must already be available in the user
session; the candidate does not assume GNOME Keyring, install packages, change
PAM settings, or unlock the provider. Windows secure storage and other platforms
report their own unavailable state rather than falling back to plaintext.
Chrome may overlap Native Messaging host processes while its Manifest V3
background context is restarting. Each process may open the same user store;
short-lived state and refresh file locks serialize credential transitions, and
generation checks reject stale authorization, refresh, or logout writes. On Linux,
Secret Service calls use a five-second context deadline; the adapter checks the
collection/item lock state and does not call `Unlock` or `Prompt`. Windows
ciphertext replacement uses `MoveFileEx` with replace-existing and write-through
flags; Windows runtime behavior remains untested.

If the user starts sign-in again while an earlier browser authorization is still
waiting, the newer request cancels and replaces the older flow. The user does not
need to find or terminate a host process after an authorization timeout.

Protected blobs use random immutable version IDs. A private local pointer names
the only version that can be read and records the session generation. Its blob
ID changes only after a secure-store write is acknowledged and the local atomic
replacement succeeds. A cancelled Linux D-Bus write may still land later at
the service; its unique version stays unreachable. Logout atomically advances
the local generation first, so an older blob can retain reauthorization data
without exposing its session tokens after a restart.

## Build and run tests

From this directory, with Go 1.26.0 or later:

```sh
go test ./...
GOOS=linux GOARCH=amd64 go build -o /tmp/translateflow-host-linux ./cmd/translateflow-host
GOOS=windows GOARCH=amd64 go build -o /tmp/translateflow-host-windows.exe ./cmd/translateflow-host
```

The runtime has no Node.js or Python dependency. Direct Go modules provide OIDC
verification, OAuth PKCE, process-safe file locks, Linux D-Bus Secret Service
access, and Windows system calls. Tests use an in-process fake HTTP server and
fake secure-blob stores. A delayed-apply backend simulates a D-Bus service
committing a cancelled immutable write after logout; a helper subprocess then
reopens the pointer and verifies the session stays invalid. Store recreation
and refresh contention tests are in-process simulations. A helper subprocess
reopens the credential pointer to exercise restart recovery.
Tests never contact OpenAI or the actual OS credential store.

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

Supported methods are `hello`, `auth.status`, `auth.start`, `auth.select`, `auth.logout`,
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

Each account registration is stored separately from its session tokens. The
active account can be selected without overwriting another registration.
Adding an account creates a distinct issued client ID and reuses this host's
stable host ID. Logout advances the session generation and clears only the
active account's tokens before waiting on remote revocation; its issued client
ID, subject, label, and host ID remain available for reauthorization. Version 1
single-account records are migrated in memory and retained on the next safe
credential update; the host never clears credentials to perform migration.
Refreshes are serialized across host processes, re-read the latest expiry after
acquiring the refresh lock, and use generation-checked commits so an in-flight
refresh or callback cannot restore a session after logout. Credential updates
and logout are serialized by a separate state lock. Corrupt secure-store records
are surfaced as errors instead of being silently reset. The complete sign-in
and sign-out flow is bounded by the configured authentication timeout.

## Extension connection owner

The MV3 background service worker is the sole owner of
`chrome.runtime.connectNative` and the native host port. Popup, Options,
Content, and other extension callers send validated runtime messages to that
owner; it forwards requests over the shared port and correlates `requestId` and
sequence frames. They must not open separate native host connections.

The Native Messaging host name is `com.coderlambert.translateflow`. Before
release, the root extension manifest's `permissions` array declares
`nativeMessaging`, and the user-level host manifest must allow the extension's
exact Chrome origin. A pinned release extension ID is not included in this
candidate; installation behavior and expected paths are documented in
[`INSTALLATION.md`](INSTALLATION.md).

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
