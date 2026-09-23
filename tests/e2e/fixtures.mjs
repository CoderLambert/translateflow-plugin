import { test as base, expect } from "@playwright/test";
import { startE2EServer } from "./helpers/servers.mjs";
import {
  configureExtension,
  injectExtension,
  launchExtension,
  prepareTestExtension,
  sendContentMessage,
  getEffectiveContext,
  setLocalConfig,
  getLocalConfig
} from "./helpers/extension.mjs";

export const test = base.extend({
  harness: async ({}, use) => {
    const server = await startE2EServer();
    const bundle = await prepareTestExtension();
    const launched = await launchExtension(bundle.path);

    await configureExtension(launched.controlPage, {
      apiBaseUrl: server.apiBaseUrl
    });

    const harness = {
      ...launched,
      server,
      async openFixture(suffix = "") {
        const page = await launched.context.newPage();
        await page.goto(server.fixtureUrl(suffix));
        await injectExtension(launched.controlPage, page);
        return page;
      },
      async send(page, message) {
        return sendContentMessage(launched.controlPage, page, message);
      },
      async translatePage(page, taskId = crypto.randomUUID()) {
        return sendContentMessage(launched.controlPage, page, {
          type: "ABT_TRANSLATE_PAGE",
          taskId
        });
      },
      async contextFor(pageUrl) {
        return getEffectiveContext(launched.controlPage, pageUrl);
      },
      async setConfig(patch) {
        return setLocalConfig(launched.controlPage, patch);
      },
      async getConfig(keys) {
        return getLocalConfig(launched.controlPage, keys);
      }
    };

    try {
      await use(harness);
    } finally {
      await launched.context.close();
      await bundle.cleanup();
      await server.close();
    }
  }
});

export { expect };
