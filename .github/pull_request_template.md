## What changed

- 

## Verification

- [ ] `npm run validate`
- [ ] Chrome `chrome://extensions` reload completed
- [ ] Manual translation smoke-tested
- [ ] Cache restore smoke-tested when cache behavior changed
- [ ] Auto-translation site smoke-tested when content/permission logic changed

## Risk checklist

- [ ] No API key / secret committed
- [ ] No new host permission without rationale
- [ ] IndexedDB schema/version unchanged or migration documented
- [ ] Message protocol changes are centralized in `src/shared/constants.js`
