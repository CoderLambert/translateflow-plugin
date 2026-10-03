import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { classicContractPath, checkClassicContract } from "../scripts/reading-contract-classic.mjs";
import { READING_METHOD, READING_PROTOCOL_VERSION } from "../src/shared/reading/constants.js";
import { validateReadingRequest } from "../src/shared/reading/dto.js";

test("classic Reading bridge matches canonical source and rejects wrong versions/extra fields", async () => {
  await checkClassicContract();
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: { modules: {} }, TextEncoder });
  const source = await readFile(classicContractPath, "utf8");
  vm.runInContext(source, context);
  const bridge = context.__TRANSLATE_FLOW_CONTENT__.modules.readingContract;
  const request = { protocolVersion: READING_PROTOCOL_VERSION, method: READING_METHOD.GET_RECORDING_STATE };
  const validate = (value) => {
    context.requestJson = JSON.stringify(value);
    return vm.runInContext("__TRANSLATE_FLOW_CONTENT__.modules.readingContract.validateReadingRequest(JSON.parse(requestJson))", context);
  };
  assert.deepEqual(JSON.parse(JSON.stringify(validate(request))), validateReadingRequest(request));
  for (const bad of [{ ...request, protocolVersion: 1 }, { ...request, userInitiated: true }]) {
    assert.throws(() => validate(bad));
  }
  vm.runInContext(source, context);
  assert.equal(context.__TRANSLATE_FLOW_CONTENT__.modules.readingContract, bridge);
});
