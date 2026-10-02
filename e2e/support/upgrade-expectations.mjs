// #249 adds this one missing setting. Every existing value and all non-storage
// snapshot fields remain subject to exact old→WXT equality.
export function expectedUpgradeSnapshot(before) {
  return {...before,storage:Object.hasOwn(before.storage,"uiLocale")
    ? before.storage : {...before.storage,uiLocale:"auto"}};
}
