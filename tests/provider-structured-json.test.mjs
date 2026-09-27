import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderRequestError,
  requestParsedJson
} from "../src/background/providers/shared.js";

test("requestParsedJson retries malformed Selection schema and then succeeds", async () => {
  let attempts = 0;
  const result = await requestParsedJson({
    providerLabel: "Mock",
    request: async () => {
      attempts += 1;
      return {
        choices: [{
          message: {
            content: attempts === 1
              ? JSON.stringify({ explanation: "missing selectedCandidateIds" })
              : JSON.stringify({
                  selectedCandidateIds: [],
                  explanation: "ok",
                  translation: ""
                })
          }
        }]
      };
    },
    parseResult: (value) => {
      if (!Array.isArray(value.selectedCandidateIds)) {
        const error = new Error("selectedCandidateIds required");
        error.code = "SELECTION_EXPLAIN_PROTOCOL";
        throw error;
      }
      return value;
    }
  });

  assert.equal(attempts, 2);
  assert.equal(result.explanation, "ok");
});

test("requestParsedJson stops after malformed retry budget", async () => {
  let attempts = 0;
  await assert.rejects(
    requestParsedJson({
      providerLabel: "Mock",
      maxAttempts: 2,
      request: async () => {
        attempts += 1;
        return { choices: [{ message: { content: "{}" } }] };
      },
      parseResult: () => {
        const error = new Error("invalid schema");
        error.code = "SELECTION_EXPLAIN_PROTOCOL";
        throw error;
      }
    }),
    (error) => error instanceof ProviderRequestError && error.code === "MALFORMED_RESPONSE"
  );
  assert.equal(attempts, 2);
});
