# Type and test tooling v1 (#247)

Base: `b10c2b355896530f15f69ebad996afc490760ae7` (#246 merged). This slice adds tooling and test fixtures; the only legacy source edit is `normalizeSourceText()`'s `unknown → string` JSDoc. The seven-line WXT background entry changes extension from JS to TS, retaining its static import and synchronous listener registration. Default packaging remains the old allowlisted build until #248.

## Fixed toolchain

Use Node `24.21.0`, npm `11.19.0` and `npm ci`. The lock fixes TypeScript `5.9.3`, Vitest `5.0.3`, React/React DOM and their types `19.3.0`, `@types/node 24.10.1`, WXT React module `1.2.2`, Vite React plugin `5.1.4`, jsdom `26.1.0`, Testing Library React `16.3.2`, DOM `10.4.1` and user-event `14.6.1`. Existing WXT `0.21.4`, Vite `7.3.1` and Playwright `1.63.0` stay fixed. All are development/build dependencies; installation does not authorize them in every runtime context.

The npm metadata check confirmed Vitest supports Node 24/Vite 7 and Testing Library React supports React 19 plus DOM 10. jsdom 26.1.0 supports Node >=18 and supplies the single DOM test environment. An initial query for jsdom 30.2.0 returned E404; 30.1.0 metadata supported Node 24 but the actual install failed because its `whatwg-url ^17.1.1` dependency was unavailable. The bounded fallback to the checked 26.1.0 installed successfully, without force, legacy-peer-deps or a global configuration change.

## Commands and runner boundaries

```bash
npm ci --no-audit --no-fund
npm run validate
npm run build:extension:wxt
```

`validate` runs, in order: source/architecture check, existing Node regressions, strict types, Vitest, and the existing default allowlisted build. `typecheck` and `test:unit` each run `wxt prepare` before their runner, so standalone use does not depend on another command having generated types. Browser execution stays outside `validate`.

| Runner | Discovery | Environment |
| --- | --- | --- |
| Node | `tests/*.test.mjs` | existing Node regressions and isolated CLI failure fixtures |
| Vitest | `tests/unit/**/*.test.ts`, `tests/unit/**/*.test.tsx` | Node by default; component file explicitly requests jsdom |
| Playwright | `e2e/**/*.spec.mjs` | unchanged isolated Chromium extension E2E |

Vitest does not accept an empty suite. Its three tests cover the real existing JS normalizer, unknown Reading input rejected/accepted by the existing #230 validator, and a test-only React control changed twice by actual user-event clicks. The fixture neither persists data nor implements the product consent flow. Actual runner discovery and intersections are recorded in `types-tests-v1/runner-discovery.json`.

## Strict types and the WXT declaration boundary

All new `src` and `entrypoints` TS/TSX/MTS/CTS, unit TS/TSX, the Vitest config, and owned declarations participate in strict compilation. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are enabled; `skipLibCheck:false` remains enabled for declaration checking. Legacy JS retains `allowJs:true`, `checkJs:false`; no wholesale conversion or blanket module declaration is added. A CLI fixture with `string = 42` and another with an unresolved type in a local `.d.ts` both really exit nonzero.

Reading contracts remain in `src/shared/reading/`. The typed test receives `unknown`, calls the existing request validator, and leaves its result `unknown` until a consumer needs narrowing. No DTO schema, authorization scope or storage rule is copied into UI. Runtime validation does not establish sender authority or committed storage.

The selected WXT/Browser declarations initially failed strict compilation: Browser 0.3.4 references a global `typeof chrome`; WXT's generated i18n declaration references `I18n.Static`; adding a separate Chrome SDK duplicated HAR aliases. `types/wxt-compat.d.ts` instead supplies type-only names from the exact installed Browser SDK. `chrome` is `typeof Browser`; `I18n.Static` is `Omit<typeof Browser.i18n, "getMessage">`, because WXT already removes the SDK `getMessage` before composing its generated message-key overloads. Using the complete SDK i18n shape first failed overload compatibility; the omission follows WXT's actual `WxtBrowser` composition. There is no runtime shim, `any`, ignored type error, second Chrome SDK, or edit to dependency/generated files.

`tsconfig.json` explicitly checks generated `paths.d.ts` and `i18n.d.ts`, which describe the APIs used by this extension. It does not import the unused generated `globals.d.ts` into the Node/Vite declaration domain. A separate full-environment probe including `.wxt/wxt.d.ts` still **FAILS (exit 2)**: Vite's `ModuleRunnerImportMeta.env` cannot extend the required WXT `ImportMetaEnv` properties. This is not counted as a passed full WXT environment check. A search of all runtime roots found no `import.meta.env` use; that environment is **NOT VERIFIED / unsupported by this type setup**. A future consumer must resolve this boundary before using it, without excluding owned TS or declarations. The full probe config and exact diagnostic are retained in `types-tests-v1/`.

## Source and runtime guards

`scripts/check.mjs` discovers every actual JS/MJS/CJS/JSX/TS/MTS/CTS/TSX source; only root `.wxt`, `.output`, `dist`, `.git` and dependency trees are excluded. A directory named `src/dist` remains checked. JS syntax retains Node's real parser; the fixed TypeScript AST checks typed syntax and architectural ownership.

Runtime imports, re-exports, literal dynamic imports, require calls and implicit JSX runtime dependencies form an audited relative dependency graph. Computed imports, unresolvable/escaping sources, runtime imports of tests/build sources and unregistered bare packages fail. React is allowed only under `entrypoints/learning-center/` and `src/learning-center/`; every other runtime source's transitive closure must stay React/JSX-free, including Background, Content, MAIN, Worker and shared. Pure platform adapters may use audited relative pure helpers.

The original API owners remain: Provider external fetch, the exact local package-resource reader, cache-db IndexedDB, auto-sites registration, and shared free of Chrome/Browser APIs. The shared closure also cannot acquire network, IndexedDB or registration effects indirectly from an otherwise approved owner. The API check uses real lexical binding symbols: named/literal access and same-source `const` key/global/SDK aliases are supported, including constant chains, string concatenation/templates and scoped shadowing. An unknown computed key on a proven global or SDK object fails closed. Unrelated data properties and locally shadowed global names are not classified as browser APIs. This is bounded lexical analysis, not a general interprocedural JavaScript evaluator; the prior broad claim about aliases/computed access was corrected after the independent audit exposed constant-key bypasses. The exact YouTube MAIN observer retains its original wrapper forwarding `original.apply(this, args)`; other direct or aliased fetch calls still fail. No Reading IndexedDB exception is introduced before #233. Existing source/entry length bounds remain. CLI fixtures run the identical check against isolated temporary projects and verify positive cases plus each nonzero failure; they do not disable a production check to obtain PASS.

Quality CI now uses fixed Node 24.21.0, clean npm ci and the same total validate. E2E remains independent, with entry/type/config/unit/check changes included in its filters. Frozen certification scope resolution and performance gates are untouched.

## Actual package evidence and compatibility

`types-tests-v1/verification.json` binds commands and results to the implementation commit. The actual WXT package contains 143 files / 1,371,155 bytes, zero dictionaries in this development checkout, and exactly the same path/size/SHA values as #246 (tree digest `a1efd882ce51597284f08b1b7fef4edda425354d31ee8f549098e22647622453`). Its compiled modules contain no React, Vitest, Testing Library, DOM emulator or fake-browser dependency. The production Manifest remains exactly equal to the baseline; missing generated dictionaries remain explicit. The old default build still contains 233 files, with only the normalizer comment adding source bytes.

An additional actual WXT smoke uses an isolated temporary copy/profile, a synthetic Core fixture, reviewed local Technical pack and localhost deterministic Provider. It is separate from production bytes and does not use paid Providers. Exact outcome and omissions are in `browser-smoke.json`; it is not a same-ID upgrade or full E2E claim.

Rollback is a normal reviewed revert of this tooling slice: remove the new configurations/test fixtures/type aliases and restore the thin entry's JS extension. No DB schema, user settings, runtime protocol, cache identity or permission migration is involved.

## Primary references

- [WXT frontend modules](https://wxt.dev/guide/essentials/frontend-frameworks.html): configure the official React module; this project's auto-imports remain disabled.
- [WXT unit testing](https://wxt.dev/guide/essentials/unit-testing.html): the WXT fake-browser plugin is available, but these pure/DOM tests need no extension API mock and do not install that plugin in Vitest.
- [Vitest environments](https://vitest.dev/guide/environment.html): Node default and explicit per-file jsdom environment.
- [TypeScript gradual JS migration](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html): retain JS with real JSDoc/type boundaries.
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/): assert interactions through user-visible controls.
- Registry engine/peer checks used exact-version `npm view` for the versions above; the checked metadata is summarized in `verification.json`.
