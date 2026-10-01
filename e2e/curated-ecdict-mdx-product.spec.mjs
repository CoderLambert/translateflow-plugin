import { test, expect } from "./support/extension-fixture.mjs";

const RECIPE_ID = "ecdict-en-zh-mdx-curated";
const PERMISSION_ORIGINS = [
  "https://github.com/*",
  "https://release-assets.githubusercontent.com/*"
];

test.describe("curated ECDICT MDX Settings card", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("denied exact GitHub and release-asset permissions stop before download or import", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.addInitScript(() => {
      window.__tfEcdictPermissionRequests = [];
      window.__tfEcdictWorkerCreations = 0;
      const originalRequest = chrome.permissions.request;
      chrome.permissions.request = async (details) => {
        window.__tfEcdictPermissionRequests.push(details);
        return false;
      };
      window.__tfEcdictPermissionStubInstalled =
        chrome.permissions.request !== originalRequest;

      const NativeWorker = window.Worker;
      window.Worker = new Proxy(NativeWorker, {
        construct(target, args) {
          window.__tfEcdictWorkerCreations += 1;
          return Reflect.construct(target, args);
        }
      });
      window.__tfEcdictWorkerSpyInstalled = window.Worker !== NativeWorker;
    });

    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const row = options.locator(
      `#curatedDictionaryList [data-recipe-id="${RECIPE_ID}"]`
    );
    await expect(row).toBeVisible();
    await row.locator("[data-action='install']").click();
    await expect(row.locator('[aria-live="polite"]')).toContainText(
      "下载权限未获准，尚未开始下载。"
    );

    const evidence = await options.evaluate(async () => {
      const listing = await chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" });
      return {
        permissionRequests: window.__tfEcdictPermissionRequests,
        workerCreations: window.__tfEcdictWorkerCreations,
        permissionStubInstalled: window.__tfEcdictPermissionStubInstalled,
        workerSpyInstalled: window.__tfEcdictWorkerSpyInstalled,
        dictionaries: listing.dictionaries || []
      };
    });
    expect(evidence.permissionRequests).toEqual([{ origins: PERMISSION_ORIGINS }]);
    expect(evidence.workerCreations).toBe(0);
    expect(evidence.permissionStubInstalled).toBe(true);
    expect(evidence.workerSpyInstalled).toBe(true);
    expect(evidence.dictionaries).toEqual([]);
    expect(harness.server.calls).toHaveLength(0);
  });
});
