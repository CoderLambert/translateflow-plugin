import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRichMddLookupActive,
  createRichMddLookupCancellation
} from "../src/background/packs/rich-mdd-lookup-cancellation.js";

const REQUEST = "selection-mdd-resource-0123456789abcdef0123456789abcdef";
const OWNER_A = "selection:1:0:content:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OWNER_B = "selection:1:0:content:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

test("MDD resource cancellation aborts only the owning active request", () => {
  const cancellation = createRichMddLookupCancellation();
  const operation = cancellation.begin({ requestId: REQUEST, ownerKey: OWNER_A });

  assert.deepEqual(cancellation.cancel(REQUEST, OWNER_B), {
    cancelled: false,
    phase: "owner-mismatch"
  });
  assert.equal(operation.controller.signal.aborted, false);

  assert.deepEqual(cancellation.cancel(REQUEST, OWNER_A), {
    cancelled: true,
    phase: "active"
  });
  assert.equal(operation.controller.signal.aborted, true);
  assert.throws(
    () => assertRichMddLookupActive(operation.controller.signal),
    (error) => error?.name === "AbortError"
  );
  cancellation.finish(operation);
});

test("MDD resource cancellation tombstone stops a request that starts after cancel", () => {
  const cancellation = createRichMddLookupCancellation();
  assert.deepEqual(cancellation.cancel(REQUEST, OWNER_A), {
    cancelled: true,
    phase: "pending"
  });
  assert.throws(
    () => cancellation.begin({ requestId: REQUEST, ownerKey: OWNER_A }),
    (error) => error?.name === "AbortError"
  );
});

test("MDD resource cancellation tombstone cannot be claimed by another content owner", () => {
  const cancellation = createRichMddLookupCancellation();
  cancellation.cancel(REQUEST, OWNER_A);
  assert.throws(
    () => cancellation.begin({ requestId: REQUEST, ownerKey: OWNER_B }),
    (error) => error?.code === "RICH_MDD_INPUT"
  );
});
