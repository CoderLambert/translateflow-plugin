# API key Provider connections candidate self-check

- Candidate: `886e5759b204b7dab840380f4f8431ebe179e972`
- Scope: exact diff from `origin/main` through the candidate commit
- Result: no unresolved correctness, security, data migration, cache identity, permission, packaging, Selection assistant, connection-test feedback, or recovery-path defect found

Checked that credentials remain in trusted background storage and are absent from public connection responses; Provider selection, cache identity, request coalescing, and effective-config snapshots use the same connection revision; missing references fail explicitly; legacy settings migrate without deleting old fields; local HTTP and empty-key operation require explicit flags; native response parsing requires complete unique segment coverage; Selection assistant requests use the effective target language; extension-reload failures tell stale Selection pages to refresh; and connection tests expose loading, success, and error feedback inside the affected card.

The candidate passed every declared validation command. A real local LM Studio `hy-mt2-7b` connection test returned `OK`, and the packaged translation path translated `releases` as `版本发布`. Paid endpoints and the additional environments listed by the smoke report remain unverified. The WXT platform-code budget warning is advisory.
