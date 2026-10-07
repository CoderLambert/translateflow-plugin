# Native host installation readiness

This note describes the candidate's user-level install path. No registration,
browser setting, native permission, OAuth client, account, or credential is
created by the build or by these checks.

## Product status

- The repository has no previously existing native-host installer. The Go
  executable now owns the small `install` and `uninstall` commands as well as
  the stdio host entry point.
- The target is **Google Chrome stable** on Windows, and either Google Chrome
  stable or Chromium on Linux. Chrome for Testing, Edge, and custom browser
  profile paths are not covered by this candidate.
- `manifest.json` currently has no fixed `key` and the repository does not
  record a Chrome Web Store extension ID. An unpinned build can only be
  installed by providing `--extension-id`; a release build can pin the exact
  public ID with `-ldflags "-X main.pinnedExtensionID=<ID>"`, after which
  opening the installer with no arguments performs the current-user install.
  Until the stable ID is decided, a true double-click install is not ready.
- For a local development extension, use the current ID shown at
  `chrome://extensions` with Developer mode enabled. A Chrome Web Store upload
  or Developer Dashboard is not required to obtain that development ID. A
  development ID may differ from the published ID unless the final manifest
  has a stable `key`.
- The extension manifest still lacks `nativeMessaging`. The required
  declaration belongs in the root `manifest.json` `permissions` array. It is
  listed here for review and was not added in this candidate. The extension
  host does not need an additional network `host_permissions` entry for Native
  Messaging.

## Host registration

The host name is `com.coderlambert.translateflow`. The extension calls
`chrome.runtime.connectNative()` from its background service worker; Chrome
starts the host only when that connection is requested.

The installer creates this manifest, with the absolute executable path and the
one exact extension origin supplied at install time:

```json
{
  "name": "com.coderlambert.translateflow",
  "description": "TranslateFlow ChatGPT Native Host",
  "path": "<absolute path to this user's translateflow-host executable>",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<exact-32-character-extension-id>/"]
}
```

No wildcards or additional extension origins are accepted.

| Platform | Executable | Host manifest | Registration |
| --- | --- | --- | --- |
| Linux, Chrome | `~/.local/share/translateflow/native-host/translateflow-host` | `$XDG_CONFIG_HOME/google-chrome/NativeMessagingHosts/com.coderlambert.translateflow.json` (normally `~/.config/google-chrome/NativeMessagingHosts/...`) | Manifest file in Chrome's user-level host directory |
| Linux, Chromium | `~/.local/share/translateflow/native-host/translateflow-host` | `$XDG_CONFIG_HOME/chromium/NativeMessagingHosts/com.coderlambert.translateflow.json` (normally `~/.config/chromium/NativeMessagingHosts/...`) | Manifest file in Chromium's user-level host directory |
| Windows | `%LOCALAPPDATA%\TranslateFlow\NativeHost\translateflow-host.exe` | Beside the executable | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.coderlambert.translateflow`, default value points to the manifest |

The Go candidate is one executable per target OS. A development build may be
checked without writing paths:

```sh
translateflow-host install --extension-id <exact-id> --dry-run
translateflow-host install --extension-id <exact-id> --browser chromium --dry-run
translateflow-host uninstall --browser chromium --dry-run
```

The `--extension-id` must be exactly 32 lowercase characters from `a` through
`p`. The normal `install` command writes only the current user's files and the
selected browser's registration. Linux accepts `--browser chrome` (default)
or `--browser chromium`; Windows accepts `--browser chrome`. It refuses to
overwrite an unrecognized manifest or registration. Chrome and Chromium are
registered separately and must be uninstalled with the matching `--browser`
value.

## Omarchy / Hyprland Linux session

The Linux paths follow the user-level Chrome and Chromium Native Messaging
locations under `$XDG_CONFIG_HOME` (normally `~/.config`). Hyprland does not
change the path scheme. For saved credentials and OAuth, the current user
session must expose `DBUS_SESSION_BUS_ADDRESS` and an unlocked Secret Service
provider. If the address or provider is unavailable, the host reports that
state and does not save credentials. If the provider is locked or requires an
interactive prompt, the host reports a locked-store error and does not call
Secret Service `Unlock` or `Prompt`.

The candidate does not assume GNOME Keyring, install dependencies, alter PAM,
or select a distro package. Any package needed to provide Secret Service in a
particular Omarchy setup remains approval-pending until the actual user session
is inspected and a package choice is approved. Installation and uninstallation
touch only the selected browser's registration, host manifest, and host binary;
they preserve the separate credential store.

## Removal and rollback

Run `translateflow-host uninstall --dry-run` to inspect the paths, then
`translateflow-host uninstall` to remove this component. Linux removal requires
the expected host name, description, executable path, stdio type, and a single
valid extension origin. Windows removal requires the HKCU value to point to
this component's manifest. Conflicts are left untouched. On Windows, run
uninstall from a separate downloaded copy of the executable, such as the copy
extracted from the candidate ZIP in Downloads. If the running process is the
installed executable, uninstall stops before changing the HKCU registration or
host manifest; rerun from the separate copy.

Uninstall removes this component's selected browser registration and host
manifest. On Linux, Chrome and Chromium share the installed executable; it is
removed only after neither browser's owned manifest refers to it. Uninstall
does not invoke OAuth logout, delete ChatGPT credentials, remove the user's
secure-store data, or recursively delete application/configuration directories.
Directories are removed only when empty.

## OAuth acceptance checklist

No OAuth client registration or consent grant has been attempted. The first
real `auth.start` must be initiated by the user after the parent assistant
confirms the account/install step. The current official SIWC sign-in scope set
is `openid profile email offline_access resource.invoke
chatgpt.tokens.use.direct`; plan inference requires the granted
`chatgpt.tokens.use.direct` scope. Account eligibility and model availability
must be checked by that user's consented flow, not inferred from these offline
tests. See the official [Sign in with ChatGPT registration and sign-in
contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

Use one synthetic, non-private acceptance translation only:

> The blue book is on the desk. → 蓝色的书在桌子上。

When the user authorizes a real acceptance run, confirm the displayed scope,
send only this sentence, verify a completed streamed Responses result, and
then stop. The request must use `store:false` and `stream:true` per the official
[Models and inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

Browser registration paths follow the official [Chrome Native Messaging
manifest and user-level location documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
