## Linked Issue

Closes #

> Every implementation PR must link exactly the Issue it completes. Do not merge a hard-blocked task.

## What changed

- 

## Architecture / compatibility

- Architecture decisions:
- Permission/privacy impact:
- Cache/config/migration impact:
- Remaining risks:

## Verification

- [ ] Acceptance criteria in the linked Issue are satisfied
- [ ] `npm run validate`
- [ ] `npm run test:e2e` when Chrome/MV3/DOM/user-flow behavior changed
- [ ] Chrome `chrome://extensions` reload/manual smoke completed when applicable
- [ ] Cache restore smoke-tested when cache behavior changed
- [ ] Auto-translation site smoke-tested when content/permission logic changed
- [ ] Important test/compatibility findings were synchronized back to the Issue

## Risk checklist

- [ ] No API key / secret committed
- [ ] No new required host permission without explicit rationale
- [ ] IndexedDB schema/version unchanged or migration documented/tested
- [ ] Message protocol changes are centralized in `src/shared/constants.js`
- [ ] Scope stays within the linked Issue and its non-goals
- [ ] Required CI is green before merge

## Completion handoff

After squash merge to `main`:

- [ ] Record PR, merged commit, tests/CI and remaining risks on the Issue
- [ ] Replace `state:working` with `state:implemented`
- [ ] Re-evaluate dependent Issues; replace `blocked` with `agent-ready` only when every hard dependency is merged
