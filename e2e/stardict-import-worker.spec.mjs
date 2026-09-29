import {
  test,
  expect
} from "./support/extension-fixture.mjs";

test("Dedicated StarDict worker stages OPFS quarantine and background revalidates before activation", async ({ harness }) => {
  const page = await harness.context.newPage();
  await page.goto(
    `chrome-extension://${harness.extensionId}/options.html`
  );

  const result = await page.evaluate(async () => {
    const encoder = new TextEncoder();

    function concatBytes(chunks) {
      const total = chunks.reduce(
        (sum, chunk) => sum + chunk.byteLength,
        0
      );
      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    }

    function makeFixture() {
      const word = "workerlexeme";
      const translation = "工作词条";
      const wordBytes = encoder.encode(word);
      const dictBytes = encoder.encode(translation);
      const numbers = new Uint8Array(8);
      const view = new DataView(numbers.buffer);
      view.setUint32(0, 0, false);
      view.setUint32(4, dictBytes.byteLength, false);
      const idxBytes = concatBytes([
        wordBytes,
        new Uint8Array([0]),
        numbers
      ]);
      const ifoText = [
        "StarDict's dict ifo file",
        "version=2.4.2",
        "bookname=Worker E2E",
        "wordcount=1",
        "idxfilesize=" + idxBytes.byteLength,
        "sametypesequence=m",
        ""
      ].join("\n");

      return {
        ifoBytes: encoder.encode(ifoText),
        idxBytes,
        dictBytes,
        recipe: {
          schemaVersion: 1,
          semanticProfile:
            "en-zh-plain-text-translation-v1",
          packId: "local-worker-e2e",
          packVersion: "fixture-v1",
          sourceLanguage: "en",
          targetLanguage: "zh-CN",
          dictionary: {
            bookname: "Worker E2E",
            sourceId: "worker-e2e",
            sourceVersion: "fixture-v1"
          },
          assertions: {
            plainTextRepresentsTargetTranslation: true,
            localUseOnly: true
          }
        }
      };
    }

    const worker = new Worker(
      chrome.runtime.getURL(
        "src/options/workers/stardict-import-worker.js"
      ),
      { type: "module" }
    );
    const requestId = crypto.randomUUID();
    const progress = [];

    try {
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("StarDict worker timed out")),
          15_000
        );
        worker.addEventListener("message", (event) => {
          const message = event.data;
          if (message?.requestId !== requestId) return;
          if (message.type === "stardict-import:progress") {
            progress.push({
              phase: message.phase,
              path: message.path || ""
            });
            return;
          }
          if (message.type === "stardict-import:ready") {
            clearTimeout(timer);
            resolve(message);
            return;
          }
          if (message.type === "stardict-import:error") {
            clearTimeout(timer);
            reject(
              new Error(
                message.errorCode
                  ? message.error + " (" + message.errorCode + ")"
                  : message.error
              )
            );
          }
        });

        worker.postMessage({
          type: "stardict-import:start",
          requestId,
          input: {
            format: "plain",
            ...makeFixture()
          }
        });
      });

      const commitRequestId = crypto.randomUUID();
      const commit = await chrome.runtime.sendMessage({
        type: "DICTIONARY_LOCAL_IMPORT_COMMIT",
        token: ready.token,
        requestId: commitRequestId
      });
      const lookup = await chrome.runtime.sendMessage({
        type: "LEXICAL_LOOKUP",
        text: "workerlexeme",
        pageUrl: "https://worker-e2e.invalid/",
        sourceLanguage: "en",
        targetLanguage: "zh-CN"
      });

      const root = await navigator.storage.getDirectory();
      let tokenStillExists = false;
      try {
        const quarantine =
          await root.getDirectoryHandle(
            "dictionary-import-quarantine"
          );
        await quarantine.getDirectoryHandle(ready.token);
        tokenStillExists = true;
      } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
      }

      return {
        ready: {
          token: ready.token,
          packId: ready.packId,
          packVersion: ready.packVersion,
          fingerprint: ready.fingerprint
        },
        progress,
        commit,
        lookup,
        tokenStillExists
      };
    } finally {
      worker.terminate();
    }
  });

  expect(result.ready.packId).toBe("local-worker-e2e");
  expect(result.ready.packVersion).toBe("fixture-v1");
  expect(result.ready.fingerprint).toMatch(
    /^sha256:[a-f0-9]{64}$/
  );
  expect(
    result.progress.some(
      (item) => item.phase === "convert"
    )
  ).toBe(true);
  expect(
    result.progress.filter(
      (item) => item.phase === "stage"
    ).map((item) => item.path)
  ).toEqual([
    "entries.dat",
    "index.dat",
    "manifest.json"
  ]);

  expect(result.commit.ok).toBe(true);
  expect(result.commit.status).toBe("imported");
  expect(result.tokenStillExists).toBe(false);

  expect(result.lookup.ok).toBe(true);
  expect(result.lookup.status).toBe("candidates");
  const local = result.lookup.candidates.find(
    (candidate) =>
      candidate.provenance?.packId ===
        "local-worker-e2e"
  );
  expect(local).toBeTruthy();
  expect(local.translations).toContain("工作词条");

  await page.close();
});
