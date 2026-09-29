import {
  PACK_ERROR_CODES,
  packError
} from "./pack-manager.js";
import {
  assertImportQuarantineToken
} from "./import-quarantine-contract.js";

const LOCK_PREFIX =
  "translateflow:dictionary-import:";

export function makeImportQuarantineLockName(token) {
  assertImportQuarantineToken(token);
  return LOCK_PREFIX + token;
}

export async function acquireImportQuarantineLease(
  token,
  {
    lockManager = globalThis.navigator?.locks
  } = {}
) {
  const name = makeImportQuarantineLockName(token);
  if (!lockManager?.request) {
    return Object.freeze({
      supported: false,
      protected: false,
      name,
      release() {}
    });
  }

  let releaseGate;
  let acquiredResolve;
  let acquiredReject;
  const released = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const acquired = new Promise((resolve, reject) => {
    acquiredResolve = resolve;
    acquiredReject = reject;
  });

  const request = Promise.resolve().then(() =>
    lockManager.request(
      name,
      {
        mode: "exclusive",
        ifAvailable: true
      },
      async (lock) => {
        if (!lock) {
          acquiredResolve(false);
          return;
        }
        acquiredResolve(true);
        await released;
      }
    )
  );
  request.catch(acquiredReject);

  const granted = await acquired;
  if (!granted) {
    await request.catch(() => {});
    throw packError(
      PACK_ERROR_CODES.BUSY,
      "Import quarantine token is already owned by another live context.",
      { token }
    );
  }

  let done = false;
  return Object.freeze({
    supported: true,
    protected: true,
    name,
    release() {
      if (done) return;
      done = true;
      releaseGate();
    }
  });
}

export async function withAvailableImportQuarantineLock(
  token,
  callback,
  {
    lockManager = globalThis.navigator?.locks
  } = {}
) {
  const name = makeImportQuarantineLockName(token);
  if (
    !lockManager?.request ||
    typeof callback !== "function"
  ) {
    return {
      supported: Boolean(lockManager?.request),
      acquired: false,
      value: undefined
    };
  }

  let acquired = false;
  const value = await lockManager.request(
    name,
    {
      mode: "exclusive",
      ifAvailable: true
    },
    async (lock) => {
      if (!lock) return undefined;
      acquired = true;
      return callback();
    }
  );
  return {
    supported: true,
    acquired,
    value
  };
}
