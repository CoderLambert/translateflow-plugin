# TFLex v1 Contract

Issue: #75  
Epic: #74

TFLex is TranslateFlow's immutable lexical-data contract. It deliberately separates the **logical record model** from the **physical storage profile** so bundled extension assets and downloaded OPFS packs can use the safest access pattern for their environment.

## 1. Scope

TFLex v1 stores data only. It never carries or executes HTML, JavaScript, CSS, WebAssembly, remote-resource URLs for rendering, or model instructions.

The v1 offline language scope is:

- source: English / English-dominant technical terms;
- target: Simplified Chinese;
- unsupported language pairs return `unsupported` and fall back to the existing Translation Gateway.

## 2. Required manifest contract

Every pack has a manifest containing at least:

```json
{
  "format": "tflex",
  "formatVersion": 1,
  "readerMinVersion": 1,
  "normalizationVersion": 1,
  "packId": "core-semantic-en-zh",
  "packVersion": "source-locked-version",
  "sourceLanguage": "en",
  "targetLanguage": "zh-CN",
  "profile": "bundled-sharded-v1",
  "profileOptions": { "maxShardBytes": 524288 },
  "fingerprint": "sha256:...",
  "sources": [
    {
      "id": "pwn-3.0",
      "version": "3.0",
      "license": "source-specific",
      "provenance": "locked artifact/revision"
    }
  ],
  "files": [
    {
      "role": "lexical-data",
      "path": "shards/pe-00.dat",
      "size": 123456,
      "sha256": "..."
    }
  ]
}
```

Rules:

- unknown `formatVersion` is rejected;
- a reader lower than `readerMinVersion` rejects the pack;
- the effective physical build options that change emitted bytes (including `profileOptions.maxShardBytes`) are recorded in the manifest and fingerprint payload;
- `fingerprint` changes whenever lookup-visible data, normalization behavior, source identity, pack version or byte-affecting build-profile options change;
- `fingerprint` is SHA-256 over a deterministic fingerprint payload containing format/normalization versions, pack id/version, locked source identities and the ordered file-role/path/size/SHA-256 list; the `fingerprint` field itself and presentation-only metadata are excluded to avoid circular hashing;
- source licenses remain separate; a combined pack does not invent a new umbrella license;
- release builds consume locked/checksummed source artifacts, never live endpoints.

## 3. Logical record model

The exact byte encoding is profile-specific. Once decoded, records expose this logical shape:

```text
record
  lookupKey             # canonical case-folded key
  exactLookupKeys[]     # normalized case-preserving keys
  displayForm
  kind: lexical | technical-concept | technical-entity
  aliases[]
  lemma? / inflectionOf?
  senses[]
  sourceRefs[]
```

A lexical sense exposes:

```text
sense
  id
  partOfSpeech?
  translations[]
  domains[]
  sourceRefs[]
```

A technical concept/entity may additionally expose bounded structured facts:

```text
technical record
  entityId?        # e.g. Wikidata QID
  typeLabels[]
  aliases[]
  translations[]
  domains[]        # curated technical category/domain
  description?     # bounded structured-source description
  sourceRevision?  # locked source revision when available
```

These fields are source-dependent and optional unless a pack-specific contract says otherwise. In particular, a technical record may have an empty `translations[]` when no verified target-language label exists. The #78 Wikidata pack deliberately omits `description` and does not substitute sitelink titles or source-language display names as Simplified-Chinese translations.

No record field is trusted as an instruction when used by an AI request. Pack strings are serialized as bounded data.

## 4. Provenance rules

Every user-visible candidate must be traceable to:

```text
packId
packVersion/fingerprint
source id
source record/sense/entity id when available
```

Candidates from different sources are not silently merged merely because their Chinese strings match.

User Glossary is the only v1 source allowed to express an explicit user override. Core, Technical and optional dictionary packs contribute attributable candidates to ranking.

## 5. Normalization v1

Lookup normalization and display normalization are separate.

Lookup normalization v1 stores both a normalized exact-case form and a case-folded canonical form:

1. Unicode NFKC;
2. trim leading/trailing whitespace;
3. collapse internal Unicode whitespace to one ASCII space;
4. retain punctuation that can be lexical (`-`, apostrophes, `+`, `#`, `.`);
5. generate both exact-case and case-folded lookup forms when applicable;
6. do not apply lossy stemming as normalization.

Lemma/inflection relationships are explicit candidate edges, not irreversible key rewriting.

Display form preserves source spelling/case. Source-specific notation such as COW morphology separators may be normalized for display only if the raw source form/provenance remains recoverable.

## 6. Lookup semantics

Order of operations:

```text
exact phrase
 -> exact-case headword/alias
 -> case-folded headword/alias
 -> explicit lemma/inflection edge
 -> conservative morphology fallback
```

An unknown phrase is never rendered as a naive concatenation of per-token definitions.

The reader returns zero or more **candidates**. Ranking/sufficiency is a separate policy owned by #85.

## 7. Physical profile: bundled-sharded-v1

Evidence from #75 shows current Chromium can return a byte range from a `chrome-extension://` asset, but that behavior is not used as a v1 correctness dependency.

Bundled Core therefore uses bounded immutable shards:

```text
assets/lexicon/core/
  manifest.json
  directory/index metadata
  shards/...
```

Rules:

- build selects prefix/range subdivisions deterministically;
- target maximum compressed/uncompressed read unit is **512 KiB**; an oversized prefix is subdivided;
- the compiler records the effective `maxShardBytes` value in `profileOptions` so non-default test/build profiles remain reproducible and auditable;
- one lookup should not require materializing the whole pack;
- `directory.json` may carry an optional sorted `aliases[]` index; each normalized alias key maps to one-or-more sorted canonical `lookupKey` targets, allowing ambiguous aliases to return multiple candidates without scanning lexical shards;
- case-sensitive aliases retain exact-case keys in the alias entry; a case-sensitive alias does not match other casing;
- alias-index bytes are covered by the `directory.json` descriptor hash and therefore by the pack fingerprint;
- a small bounded directory/index may be cached in memory;
- decoded shard/entry caches are bounded LRU state and are disposable when the MV3 worker stops.

The 512 KiB value is a v1 safety budget, not a file-format invariant; changing it does not change logical `formatVersion`.

## 8. Physical profile: opfs-indexed-v1

Optional downloaded packs use a versioned OPFS directory:

```text
/dictionaries/<packId>/<version>/
  manifest.json
  index.dat
  entries.dat
```

The reader uses `File.slice(offset, offset + length)` or equivalent bounded reads. Static dictionary rows are not imported into IndexedDB.

Activation is an atomic **metadata pointer switch**, not a filesystem-rename assumption:

```text
download version N to inactive directory
 -> verify authenticated catalog metadata
 -> verify file size/hash/schema
 -> health-check reader
 -> set chrome.storage activeVersion=N
 -> retain previous healthy version until cleanup policy permits deletion
```

Missing/corrupt active data must fall back to the previous verified version when available; otherwise the pack enters a typed `needs-reinstall` state.

## 9. Optional-pack catalog trust

v1 trust policy:

- extension code ships the accepted catalog public-key IDs/public keys and a minimum accepted catalog sequence baseline;
- remote metadata cannot introduce a new trust root;
- the detached ECDSA P-256/SHA-256 signature is verified against the **exact UTF-8 catalog bytes as downloaded, before JSON parsing or reserialization**; this avoids canonical-JSON ambiguity;
- signed catalog binds monotonic catalog sequence, pack id/version, TFLex compatibility, file paths, file sizes and SHA-256 values;
- catalog file paths must be relative, normalized, inside the pack root, and must not contain traversal/absolute-path forms;
- highest accepted catalog sequence is persisted; lower sequence is rejected as replay/downgrade;
- after local state loss, the extension-shipped minimum catalog sequence still prevents rollback below the baseline bundled with that extension version;
- signing-key rotation/revocation is delivered through an extension update which adds/removes trusted keys;
- a transition release may trust old+new keys simultaneously;
- pack SHA-256 validates bytes after catalog authenticity succeeds.

This deliberately avoids remote trust-root delegation in v1.

The remaining replay window after complete local-state loss is bounded by the extension-shipped sequence baseline. A future design may add stronger remotely revocable trust if dictionary-pack risk justifies that complexity; v1 does not pretend that a cleared local high-water mark is permanent state.

## 10. Optional-origin permissions

Pack installation is initiated from Settings, not the toolbar popup.

The extension may declare broad **optional** HTTPS host capability, but a pack install requests only the exact trusted origin required for that catalog/download source. No new broad required Host Permission is introduced.

If the user rejects the permission, installation stops without modifying active-pack state.

## 11. Storage/quota policy

v1 does not require `unlimitedStorage` by default.

Before installing/updating an optional pack, the manager checks available quota and must budget for:

- the complete incoming version;
- the currently active rollback version;
- temporary/metadata overhead;
- a fixed safety margin.

Insufficient space produces a typed preflight failure instead of partially replacing the active pack.

## 12. Cache/privacy interaction

- deterministic local lexical results are not written to translation cache;
- generated Selection explanations use a separate cache namespace/fingerprint;
- raw page URL is not part of the AI payload;
- normal reading context is bounded visible text;
- editable/form-sensitive selections expose no surrounding text to AI;
- generated explanations for sensitive editable selections are non-persistent by default.

## 13. Deferred

TFLex v1 deliberately does not require:

- SQLite/WASM;
- MDict runtime rendering;
- arbitrary user-supplied remote pack URLs;
- remote executable resources;
- full-text example-sentence search;
- a giant in-memory headword map.

Those require evidence and a separate ADR/version change.
