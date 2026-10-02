# MDX boundary compatibility and large-file follow-up

## Boundary validation

Rich MDX v2 readers accept a key block only when both raw display-form endpoints
equal its stored descriptors, or both lookup-normalized endpoints equal those
descriptors (the legacy fixture representation). The descriptors themselves are
never normalized. A raw first match plus a normalized last match is insufficient.
Byte consumption, checksums, entry counts, monotonic record offsets, source
layout and resource budgets remain mandatory. Lookup bounds still use the
existing normalization independently of structural boundary validation.

No index schema or stored data migration is required: both existing normalized
indexes and new raw descriptors are read through the same validated path.
The classic structured reader already checks raw boundaries; its explicit
semantic-confirmation route still goes through the shared rich preflight first.

Preflight reasons may now include a bounded `stage` enum: `header`, `key-index`,
`record-index`, `key-blocks`, or `index-validation`. The UI renders fixed labels,
never arbitrary error messages, paths or headwords. A boundary mismatch has the
specific reason `mdx.key_block_boundary_mismatch`; generic structural failure
does not establish that the original file is damaged. Unsupported format
capabilities remain separate from malformed structures and budget limits.
The `mdict-rich` family on a failed preflight is a routing classification, not
proof of a successfully parsed header or usable records.

## Reproducible synthetic evidence

`tests/fixtures/mdx-boundaries/` contains tiny fixtures from the independent MIT
`zhansliu/writemdict` writer, pinned in `corpus-lock.json`. The generator uses
the existing Python compatibility shim and fixed header date. It does not use
TranslateFlow's parser or binary fixture encoder to create key sections.

```sh
python3 scripts/generate-mdx-boundary-fixtures.py \
  --writer-checkout /path/to/pinned/writemdict \
  --out-dir tests/fixtures/mdx-boundaries
node --test tests/mdict-boundary-interop.test.mjs
npx playwright test e2e/mdict-boundary-preflight.spec.mjs
```

Native writer cases cover uppercase, NFKC width changes, UTF-8/UTF-16, multiple
blocks and encrypted key info. Since the writer has no StripKey/case options,
those tests explicitly change only the header and recompute its checksum;
writer key/record sections stay unchanged. Separate rechecksummed descriptor
mutations and decoder tests cover legacy pairs, mixed endpoints, normalization
collisions, trailing bytes and decreasing offsets. Browser tests exercise
preflight, install, reload, lookup, failure labels and disabled installation.
These are synthetic interoperability tests, not certification of private
dictionaries or broad MDict compatibility. See the existing
[real-world evidence matrix](MDICT_REAL_WORLD_COMPATIBILITY.md).

## Large dictionaries: proposed scope, not implemented support

The follow-up target is one rich MDX plus its complete MDD set totaling at most
**4 GB = 4,000,000,000 bytes** (decimal, about 3.73 GiB). This document does not
raise any current limit or certify a 4 GB browser import. Structured MDX,
StarDict and TFLex budgets must stay independent.

Current gates differ intentionally: the selection set is capped at 640 MiB;
MDX and individual MDD files at 128 MiB; MDD files together at 512 MiB. The
logical decoded record streams have separate caps (rich MDX 256 MiB, MDD
128 MiB). Compressed file size does not predict that decoded stream size.

The existing rich path reads `File.slice()` ranges and writes the source File
to OPFS without a JavaScript whole-source buffer. Offsets use checked safe
integers read from 64-bit fields. However, a safe expansion still needs:

1. One rich-only capacity contract across selection, controllers, workers,
   background preflight, commit and reload. Background commit must validate the
   actual installed MDX source size plus the complete proposed MDD set, including
   existing resources as appropriate; separate 4 GB allowances would be wrong.
2. Separate finite budgets for container bytes, cumulative decoded work and
   per-block memory. Preserve the rich 4 MiB compressed/decompressed block caps,
   512 KiB record cap, 8 MiB resource cap, compression ratio checks, index/entry/
   query budgets, 16-companion cap, safe paths and content checks. Do not derive a
   hundreds-of-gigabytes decoded-work allowance from file size times ratio.
3. Cancellable OPFS copying with progress. `opfs-store.writeFile` currently
   awaits one `writable.write(File)` without an AbortSignal; cancellation must
   await write termination and staging cleanup before reporting completion.
   Preserve the old active dictionary during replacement. Pass cancellation to
   all MDD block inflation paths, including commit-time full record verification.
4. Quota failure and replacement tests. `navigator.storage.estimate()` is an
   estimate, not a reservation; old active data, new staging and indexes all
   occupy storage. Failed writes must keep the old dictionary usable and clean
   only the failed session's staging files.

Relevant owners: `local-dictionary-preflight-contract.js`,
`local-dictionary-preflight-mdx.js`, `rich-mdict-contract.js`,
`rich-mdict-install-preflight.js`, `rich-mdd-contract.js`,
`rich-mdd-resources.js`, `opfs-store.js`, `importers/mdict-rich-validation.js`,
`importers/mdd-validation.js`, `importers/mdd-index.js`, and their import workers.
MDD commit rebuilds the staged index and decodes all record blocks, so increasing
capacity also increases real I/O and validation work.

Mock range sources should test high offsets above 2 GiB, exact byte boundaries
and plus-one failures, combined capacity, bounded reads, cancellation, quota,
cleanup and reload. Actual large-file certification additionally needs a lawful
large corpus or a valid disk-streamed synthetic MDD in a real browser, recording
peak memory, full verification time, mid-copy/inflate cancellation, restart and
last-resource lookup. Passing sparse/mock tests alone must not be reported as
4 GB OPFS support.
