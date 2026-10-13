# API key Provider connections candidate self-check

- Candidate: `272917ef84d6d992293ed3bb5759d4a1338faa2a`
- Scope: exact diff from `origin/main` through the candidate commit
- Result: no unresolved correctness, security, data migration, cache identity, permission, packaging, or recovery-path defect found

Checked that credentials remain in trusted background storage and are absent from public connection responses; Provider selection, cache identity, request coalescing, and effective-config snapshots use the same connection revision; missing or deleted connection references fail explicitly; legacy DeepSeek/OpenAI-compatible settings migrate without deleting old fields; local HTTP and empty-key operation require explicit flags; native response parsing requires complete unique segment coverage; and generated package inputs do not include repository-only assets.

The candidate passed every declared validation command. Real paid endpoints and the additional environments listed in `acceptance.json` remain unverified. The WXT platform-code budget warning is advisory and does not make the build fail.
