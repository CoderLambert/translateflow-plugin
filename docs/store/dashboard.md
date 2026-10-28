# Dashboard privacy and reviewer notes

## Single purpose

Help users translate, understand and revisit foreign-language web content and related text using their chosen translation services, local dictionaries and on-device learning records.

## Permission justification (English, ready to adapt to the dashboard)

- **storage**: Stores the user's translation preferences, configured service credentials, site choices and temporary text-translation session. Persistent cache, dictionaries and learning records use their dedicated local stores. No maintainer-hosted synchronization is provided.
- **activeTab**: Supports actions explicitly invoked for the current page, such as translating it and showing extension controls.
- **scripting**: Installs the extension's packaged scripts where the selected feature needs them, including the YouTube caption bridge. It does not download and execute remote scripts.
- **http://*/* and https://*/**: The extension provides selection lookup and floating controls on ordinary websites without requiring a toolbar click first, and translates page text when explicitly requested or when the user has enabled automatic translation. This is broad website access; it does not mean all visited page content is uploaded. Users can restrict site access in Chrome.
- **https://api.deepseek.com/***: Supports directly configured DeepSeek API requests. It is currently also covered by the broader HTTPS host pattern; do not invent a separate data purpose for it.
- **declarativeNetRequestWithHostAccess**: Applies a session request-header rule only to extension-initiated POST requests to the fixed Bilibili translation endpoint, removing Origin for this adapter. No general browsing request blocking, redirection or cross-site header modification is performed. The release decision for this service must follow the documented service-terms assessment.
- **nativeMessaging**: Not present in the public package. Do not provide developer-edition functionality as a reason for a public permission.

## Data usage disclosure mapping

The exact checkbox labels and definitions in the submission dashboard take precedence; review the final package against them. Do not select “no data handled” merely because there is no maintainer server.

| Dashboard category | Handling relevant to TranslateFlow |
| --- | --- |
| Website content | Page text, selections, captions and relevant AI context are processed and can be sent to selected services |
| Web history / browsing activity | URLs, origins and titles are used for site settings, cache identity and enabled reading records; no unrelated cross-site history monetization |
| Authentication information | User-provided API keys are stored locally and sent for authentication to that configured service |
| Personal communications / personal, health or financial information | The extension does not independently request these categories, but users may select or paste such content on a page. Apply the dashboard definitions and final collection scope honestly rather than promising the extension can never encounter it |
| User activity | User actions initiate translation and record management; no analytics/keystroke tracking for unrelated profiling. Keyboard shortcuts and input editing are functional controls |
| Location | No GPS/location API or location feature. External hosts can receive ordinary network metadata such as IP addresses |

Use of data is limited to the user-facing translation/reading features. No sale, personalized advertising, data brokerage, creditworthiness evaluation or unrelated human review. External AI services have their own terms and retention; these must be disclosed rather than described as maintainer-controlled deletion.

## Remote code answer

The public package contains its executable extension code. AI responses and downloaded dictionary records are handled as untrusted data, not code. Dictionary scripts are not executed; rendering is controlled and external resources are restricted. The current package must still pass the production asset/remote-code check; server-side AI inference is not itself remote JavaScript execution in the extension.

## Reviewer instructions

The public edition does not require Native Host, a ChatGPT account, command-line installation, or access to a maintainer's private server.

1. Install and open the toolbar popup, then Settings. The User guide and About → Privacy/support documents can be opened without a working AI connection.
2. Configure one supported AI service with a model and API credential supplied through the dashboard's private test-instructions channel, if the maintainer chooses to provide one. Alternatively use an available free-online method after explicitly accepting its disclosure. No working credential is embedded in the package or this document.
3. Open https://coderlambert.github.io/translateflow-plugin/demo.html (the public reading example) or another public article. Translate the page, compare original and translated text, hide/show the translation, and restore cache. Cache restoration does not fill misses by calling a service.
4. Select ordinary page text to open lookup. A local dictionary must be imported before local dictionary results can appear. AI detail is a separate explicit action.
5. Open AI text translation from the popup. Enter a short non-sensitive sentence, choose a target language and scene, submit, copy and refine it. This feature uses a configured AI service and does not inherit free-online page mode.
6. Cancel an active translation and retry an actual recoverable failure. Permission denial and unsupported browser pages should present a recovery path.
7. YouTube assistance requires a video with available captions, a playable site session and a ready translation method. The extension does not generate missing captions or bypass YouTube login/anti-bot restrictions.
8. Reading records have separate consent/enabling. Inspect pause, site exclusion and deletion; text-window session results do not automatically become reading history.

The local model endpoint used in developer acceptance is not a public reviewer service. Do not send reviewers an inaccessible LAN address. If confidential test access is required, the maintainer must provide a restricted suitable service through the dashboard, with its use authorized and monitored.

## Screenshots and publication

Use the actual PNGs from the accompanying local submission directory. A screenshot's provenance is listed in screenshots.json: extension version, fixture vs real-model source and language. Do not represent a deterministic mock-provider output as evidence of a real cloud service's translation quality. Avoid credentials and private URLs in screenshots. Upload the ZIP whose SHA-256 is recorded in the release manifest; it is a candidate until all remaining owner-dependent conditions are resolved.
