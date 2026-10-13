# API key Provider connections candidate self-check

- Candidate: `b2440ec6414b24a4f8d33f75e96086b924758cc9`
- Scope: exact diff from `origin/main` through the candidate commit
- Result: no unresolved correctness, security, data migration, cache identity, permission, packaging, Selection assistant, or recovery-path defect found

Checked that credentials remain in trusted background storage and are absent from public connection responses; Provider selection, cache identity, request coalescing, and effective-config snapshots use the same connection revision; missing references fail explicitly; legacy settings migrate without deleting old fields; local HTTP and empty-key operation require explicit flags; native response parsing requires complete unique segment coverage; Selection assistant requests use the effective target language; and an extension-reload disconnect tells the user to refresh the stale page.

The candidate passed every declared validation command. A real local LM Studio `hy-mt2-7b` request also completed through the packaged Selection assistant Port in streaming mode and returned Chinese text. Paid endpoints and the additional environments listed in `acceptance.json` remain unverified. The WXT platform-code budget warning is advisory.
