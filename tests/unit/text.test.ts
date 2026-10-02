import { expect, test } from "vitest";
import { normalizeSourceText } from "../../src/shared/text.js";
import { validateReadingRequest } from "../../src/shared/reading/dto.js";
import { READING_METHOD, READING_SCHEMA_VERSION } from "../../src/shared/reading/constants.js";

test("existing JS normalization accepts unknown and returns a typed string without DOM", () => {
  const input: unknown = "  A\n\t中文  😀  ";
  const normalized: string = normalizeSourceText(input);
  expect(normalized).toBe("A 中文 😀");
  expect(normalizeSourceText(null)).toBe("");
  expect(normalizeSourceText(42)).toBe("42");
  expect(typeof window).toBe("undefined");
});

test("unknown Reading input uses the unique existing runtime validator", () => {
  const input: unknown = { schemaVersion: READING_SCHEMA_VERSION, method: READING_METHOD.GET_RECORDING_STATE };
  // Until a consumer needs a narrowed DTO, validated JS output stays unknown.
  // This does not create a second schema or claim sender authorization.
  const validated: unknown = validateReadingRequest(input);
  expect(validated).toEqual(input);
  expect(() => validateReadingRequest({ ...input as object, untrustedScope: "extension" })).toThrow();
});
