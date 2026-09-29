import {
  test,
  expect
} from "./support/extension-fixture.mjs";

test("Settings StarDict controller transfers into a Dedicated Worker and activates only after background revalidation", async ({ harness }) => {
  const page = await harness.context.newPage();
  await page.goto(
    `chrome-extension://${harness.extensionId}/options.html`
  );

  const result = await page.evaluate(async () => {
    const {
      createStarDictImportController
    } = await import(
      chrome.runtime.getURL(
        "src/options/stardict-import-controller.js"
      )
    );
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

    function makeFixtureFiles() {
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
        ifoFile: new File(
          [encoder.encode(ifoText)],
          "fixture.ifo"
        ),
        idxFile: new File(
          [idxBytes],
          "fixture.idx"
        ),
        dictFile: new File(
          [dictBytes],
          "fixture.dict"
        )
      };
    }

    const progress = [];
    const controller =
      createStarDictImportController({
        onProgress(event) {
          progress.push({
            phase: event.phase,
            path: event.path || ""
          });
        }
      });

    try {
      const imported =
        await controller.importDictionary({
          format: "plain",
          ...makeFixtureFiles(),
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
        await quarantine.getDirectoryHandle(
          imported.ready.token
        );
        tokenStillExists = true;
      } catch (error) {
        if (error?.name !== "NotFoundError") {
          throw error;
        }
      }

      return {
        ready: {
          token: imported.ready.token,
          packId: imported.ready.packId,
          packVersion: imported.ready.packVersion,
          fingerprint: imported.ready.fingerprint
        },
        progress,
        commit: imported.commit,
        lookup,
        tokenStillExists,
        finalPhase: controller.phase,
        activeRequestId:
          controller.activeRequestId
      };
    } finally {
      controller.dispose();
    }
  });

  expect(result.ready.packId).toBe("local-worker-e2e");
  expect(result.ready.packVersion).toBe("fixture-v1");
  expect(result.ready.fingerprint).toMatch(
    /^sha256:[a-f0-9]{64}$/
  );
  expect(
    result.progress.map((item) => item.phase)
  ).toEqual([
    "read",
    "convert",
    "stage",
    "stage",
    "stage",
    "commit",
    "done"
  ]);
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
  expect(result.finalPhase).toBe("");
  expect(result.activeRequestId).toBe("");

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
