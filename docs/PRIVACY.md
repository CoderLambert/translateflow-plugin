# TranslateFlow Privacy Policy

Scope: the public TranslateFlow Chrome extension. This policy is included with the extension. The developer is the maintainer of the GitHub project CoderLambert/translateflow-plugin.

## Data we handle

TranslateFlow translates and helps you understand web pages, captions and submitted text, with local dictionaries and learning records. The extension does not use a maintainer-operated translation proxy, advertising, usage analytics or automatic diagnostic reporting to the maintainer. It still handles website content, URLs, user input and service credentials; this is not a claim that it handles no user data.

| Data | Purpose and storage | External transmission |
| --- | --- | --- |
| Page text, selections, captions and relevant context | Extract text for translation; successful page/caption translations may be cached locally | Sent to the applicable service when you initiate online translation or AI assistance, or enable automatic translation on a site. AI assistance may include relevant context and history for the current operation |
| AI text window input, instructions and results | Translation, copying and refinement; draft and latest 20 results in browser session storage | Sent only when you submit to the selected AI service. Refinement includes the target source, previous translation and instructions; new text excludes unrelated conversation |
| API keys, service URLs and settings | Stored in the extension's local storage for this browser profile | Keys authenticate requests to your configured service; they are not automatically sent to the maintainer as page content or feedback |
| URLs, page titles, selected text, saved words and AI results | Cache identity, site preferences, returning to reading and learning; reading records have separate consent/enabling and site exclusion controls | Saving or viewing local records does not itself call a translation service. Explicit AI actions on a record send the content needed for that action |
| Imported dictionaries and companion resources | Local storage, lookup and display | Local lookup does not upload dictionary files. A separate AI action sends text needed for that action, not the whole dictionary |

## External services and network access

- **Your AI service:** you choose the endpoint and model, such as OpenAI, DeepSeek, another compatible service or a self-hosted model. Requests go directly to that endpoint. The service has its own pricing, logging, retention, training-use and international processing practices. Consult its policies. TranslateFlow cannot delete data already received by that service. Unencrypted HTTP for self-hosted services requires explicit enabling; a local address does not guarantee that the service never forwards requests to a cloud provider.
- **Free online translation:** available website adapters are Microsoft, Bilibili, Google, Volcengine, Youdao and Tencent Transmart. Automatic mode currently chooses among Microsoft, Bilibili, Google and Youdao; retrying through another service may send the same text to more than one candidate. Fixed mode uses your selected service. The interface asks for consent before sending text. Withdrawing consent and saving stops new uploads in the applicable scope. Website services may fail or impose limits; failure does not silently switch to paid AI.
- **Chrome local translation:** where available, Chrome runs translation on the device and may first download models. Browser downloads and browser-operated processing are subject to Chrome's policies.
- **Dictionary downloads and external links:** initiating a dictionary download contacts the source identified in the interface. That source may receive your IP address and ordinary request metadata. Opening support links, allowed dictionary links or external links in this policy opens the corresponding website, which has its own policies. Viewing the locally installed policy, notices or a local dictionary does not itself initiate these downloads.
- External services normally see connection IP addresses and request metadata. Submitted text can itself include personal, financial, health or communication information. Do not submit content you do not want shared with the selected service. Automatic redaction is not guaranteed.

## Permissions and your choices

The public extension uses `storage` for settings/session data and `activeTab`/`scripting` for current-page actions. HTTP/HTTPS website access supports automatic selection startup, floating controls and enabled translation features; access permission does not mean all browsing content is uploaded. `declarativeNetRequestWithHostAccess` adjusts a request header only for extension-initiated requests to Bilibili's specified translation endpoint.

The public edition does not request Native Messaging and does not offer the experimental ChatGPT subscription connection through a native component. The separate developer edition requires explicit enabling; its experimental capabilities are not public-edition promises.

You can change methods, disable automatic translation, withdraw free-online consent, pause reading records, exclude sites, and restrict website access through Chrome. Site overrides and global settings may differ; review both. Automatic cache restore only restores hits and never calls a service to fill missing translations.

## Retention, export and deletion

- Settings and API keys remain until edited, the corresponding connection is deleted, or the extension is removed. Keys are in extension local storage, not an additionally encrypted password vault. Protect your device account and browser profile.
- Translation caches follow capacity, validity and cleanup rules; remove them in Settings → Cache. Clearing cache does not also remove dictionaries, saved words or reading records.
- Remove installed dictionaries in the dictionary library. Manage, delete or export saved words and reading data using their respective learning-center controls. Pausing collection does not delete existing records.
- Text-window session data is cleared when the browser session ends or you confirm New conversation. Chrome may also clear session storage when the extension is reloaded or disabled. Closing the text window alone does not clear the session. Older entries beyond the latest 20 are discarded.
- The extension has no maintainer-hosted account storage or cloud sync. You control exported files and original dictionary files. Uninstalling does not delete files you saved separately or data retained by external services.

## Limited Use commitment

TranslateFlow's use and transfer of user data adhere to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used only to provide or improve the clearly described translation and reading/learning features. It is not sold or used for personalized advertising, data brokerage or unrelated purposes. The maintainer does not automatically collect or manually read your translation content through the extension. Information you voluntarily provide for support is used to handle that request.

## Contact and updates

Project: [CoderLambert/translateflow-plugin](https://github.com/CoderLambert/translateflow-plugin). General support: [GitHub Issues](https://github.com/CoderLambert/translateflow-plugin/issues). Issues are public: do not post API keys, private pages, conversations, original dictionary files or sensitive screenshots. For security concerns, initially request contact without publishing exploit details or secrets.

This policy will be updated with changes to features and data practices. New data purposes or uploads will be described and, where necessary, consent obtained again through the interface. The store's public policy URL should refer to a policy matching the released version.
