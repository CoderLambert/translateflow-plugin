import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireImportQuarantineLease,
  makeImportQuarantineLockName,
  withAvailableImportQuarantineLock
} from "../src/shared/import-quarantine-lock.js";
import {
  reclaimStaleImportQuarantine
} from "../src/options/import-quarantine-reclaimer.js";

const DAY = 24 * 60 * 60 * 1000;

test("quarantine lease blocks non-waiting reclaim lock until released", async () => {
  const locks = new FakeLockManager();
  const token =
    "import-123e4567-e89b-42d3-a456-426614174000";
  const lease = await acquireImportQuarantineLease(
    token,
    { lockManager: locks }
  );

  assert.equal(lease.supported, true);
  assert.equal(lease.protected, true);
  assert.equal(
    lease.name,
    makeImportQuarantineLockName(token)
  );

  const blocked =
    await withAvailableImportQuarantineLock(
      token,
      () => "should-not-run",
      { lockManager: locks }
    );
  assert.equal(blocked.acquired, false);

  lease.release();
  await waitFor(() =>
    !locks.held.has(
      makeImportQuarantineLockName(token)
    )
  );

  const available =
    await withAvailableImportQuarantineLock(
      token,
      () => "owned",
      { lockManager: locks }
    );
  assert.deepEqual(available, {
    supported: true,
    acquired: true,
    value: "owned"
  });
});

test("stale quarantine reclaim removes only old unlocked tokens", async () => {
  const now = 10 * DAY;
  const stale =
    "import-223e4567-e89b-42d3-a456-426614174000";
  const fresh =
    "import-323e4567-e89b-42d3-a456-426614174000";
  const empty =
    "import-423e4567-e89b-42d3-a456-426614174000";
  const active =
    "import-523e4567-e89b-42d3-a456-426614174000";
  const quarantine = new FakeQuarantine({
    [stale]: activity(stale, now - 2 * DAY),
    [fresh]: activity(fresh, now - 60_000),
    [empty]: {
      token: empty,
      entryCount: 0,
      fileCount: 0,
      lastModified: 0
    },
    [active]: activity(active, now - 3 * DAY)
  });
  const locks = new FakeLockManager();
  locks.held.add(
    makeImportQuarantineLockName(active)
  );

  const result = await reclaimStaleImportQuarantine({
    quarantine,
    lockManager: locks,
    now: () => now,
    staleMs: DAY
  });

  assert.deepEqual(result, {
    supported: true,
    removed: [empty, stale].sort(),
    active: [active],
    fresh: [fresh],
    skipped: []
  });
  assert.equal(
    quarantine.activities.has(stale),
    false
  );
  assert.equal(
    quarantine.activities.has(empty),
    false
  );
  assert.equal(
    quarantine.activities.has(active),
    true
  );
});

test("reclaim rechecks activity after acquiring the token lock", async () => {
  const now = 10 * DAY;
  const token =
    "import-623e4567-e89b-42d3-a456-426614174000";
  const quarantine = new FakeQuarantine({
    [token]: activity(token, now - 2 * DAY)
  });
  let inspections = 0;
  quarantine.inspectTokenActivity = async (value) => {
    inspections += 1;
    if (inspections === 1) {
      return activity(value, now - 2 * DAY);
    }
    return activity(value, now - 1_000);
  };

  const result = await reclaimStaleImportQuarantine({
    quarantine,
    lockManager: new FakeLockManager(),
    now: () => now,
    staleMs: DAY
  });

  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.fresh, [token]);
  assert.equal(quarantine.removed.length, 0);
});

test("reclaim fails safe when Web Locks are unavailable", async () => {
  const token =
    "import-723e4567-e89b-42d3-a456-426614174000";
  const quarantine = new FakeQuarantine({
    [token]: activity(token, 1)
  });

  const result = await reclaimStaleImportQuarantine({
    quarantine,
    lockManager: null,
    now: () => 10 * DAY,
    staleMs: DAY
  });

  assert.deepEqual(result, {
    supported: false,
    removed: [],
    active: [],
    fresh: [],
    skipped: [token]
  });
  assert.equal(quarantine.removed.length, 0);
});

function activity(token, lastModified) {
  return {
    token,
    entryCount: 3,
    fileCount: 3,
    lastModified
  };
}

async function waitFor(predicate) {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) =>
      setTimeout(resolve, 0)
    );
  }
  throw new Error("condition not reached");
}

class FakeQuarantine {
  constructor(values) {
    this.activities = new Map(
      Object.entries(values)
    );
    this.removed = [];
  }

  async listTokens() {
    return [...this.activities.keys()].sort();
  }

  async inspectTokenActivity(token) {
    return this.activities.get(token) || null;
  }

  async remove(token) {
    this.removed.push(token);
    return this.activities.delete(token);
  }
}

class FakeLockManager {
  constructor() {
    this.held = new Set();
  }

  async request(name, options, callback) {
    if (
      options?.ifAvailable &&
      this.held.has(name)
    ) {
      return callback(null);
    }
    this.held.add(name);
    try {
      return await callback({
        name,
        mode: options?.mode || "exclusive"
      });
    } finally {
      this.held.delete(name);
    }
  }
}
