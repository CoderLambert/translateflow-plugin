(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richNavigation) return;
  function create({ card, dictionary, initialRecord, initialQuery, request, isCurrent }) {
    const actions = app.modules.richNavigationActions, locale = app.modules.contentI18n;
    const identity = Object.freeze({ id: dictionary.id, packVersion: initialRecord.packVersion || dictionary.packVersion,
      packageVersion: initialRecord.packageVersion || dictionary.packageVersion });
    const validIdentity = typeof identity.id === "string" && /^rich-mdict-[a-f0-9-]{36}$/u.test(identity.id) &&
      [identity.packVersion, identity.packageVersion].every((value) => typeof value === "string" && /^[A-Za-z0-9_.-]{1,120}$/u.test(value));
    let history = [{ query: initialQuery, fragment: "", ...identity }], cursor = 0;
    // Associate only a numeric record position with each bounded metadata entry.
    // Rendered hosts are used for the current action, never retained in history.
    const fragmentRecords = new WeakMap();
    let currentRecord = initialRecord, hosts = [], pending = null, generation = 0, closed = false;
    const toolbar = document.createElement("div"); toolbar.className = "tf-rich-navigation";
    toolbar.setAttribute("role", "group"); locale.bindAttribute(toolbar, "aria-label", "content.rich.navigationAria");
    toolbar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0";
    const back = document.createElement("button"), forward = document.createElement("button"), status = document.createElement("span");
    back.type = forward.type = "button"; back.className = forward.className = "tf-selection-rich-retry";
    locale.bindText(back, "content.rich.back"); locale.bindText(forward, "content.rich.forward");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    toolbar.append(back, forward, status); card.mountNavigation?.(toolbar);
    function live() { if (!closed && !isCurrent()) close(); return !closed; }
    function update(key = "") {
      back.disabled = !live() || cursor <= 0; forward.disabled = !live() || cursor >= history.length - 1;
      toolbar.setAttribute("aria-busy", pending ? "true" : "false");
      if (key) locale.bindText(status, key); else { locale.unbind(status); status.textContent = history[cursor]?.query || ""; }
    }
    function cancelPending() { if (pending) { pending.cancel(); pending = null; } generation += 1; }
    function show(record, token, target) {
      if (!live() || token !== generation) return false;
      card.setResult(record, identity.id, null, null, () => live() && token === generation, true);
      return true;
    }
    function fragmentHosts(recordIndex) {
      if (recordIndex === undefined) return hosts;
      return Number.isInteger(recordIndex) && recordIndex >= 0 && recordIndex < hosts.length ? [hosts[recordIndex]] : [];
    }
    function locate(fragment, recordIndex) {
      const result = actions.locate(fragmentHosts(recordIndex), fragment);
      if (!result.found) update("content.rich.fragmentMissing");
      else if (result.duplicates) update("content.rich.fragmentFirst");
      return result;
    }
    async function navigate(raw, index = null, originHost = null) {
      const action = actions.validate(raw);
      if (!live() || !action) return;
      const recordIndex = originHost === null ? undefined : hosts.indexOf(originHost);
      if (recordIndex === -1) return;
      if (action.kind === "fragment") {
        if (locate(action.fragment, recordIndex).found) {
          history[cursor].fragment = action.fragment;
          if (recordIndex === undefined) fragmentRecords.delete(history[cursor]);
          else fragmentRecords.set(history[cursor], recordIndex);
        }
        return;
      }
      if (!validIdentity) { update("content.rich.navigationUnavailable"); return; }
      if (action.headword === history[cursor].query) {
        if (pending) { cancelPending(); show(currentRecord, generation, history[cursor]); }
        update();
        if (action.fragment && locate(action.fragment).found) {
          history[cursor].fragment = action.fragment; fragmentRecords.delete(history[cursor]);
        }
        return;
      }
      cancelPending(); const token = generation;
      card.setLoading(); hosts = [];
      const job = request(action.headword, identity); pending = job; update("content.rich.navigationPending");
      let key = "";
      try {
        const result = await job.promise;
        if (!live() || token !== generation) return;
        const records = Array.isArray(result?.dictionaries) ? result.dictionaries : [];
        const record = records.find((item) => item?.id === identity.id);
        if (!result?.ok || result.cancelled || result.errors?.length || result.found && (!record || record.packVersion !== identity.packVersion || record.packageVersion !== identity.packageVersion)) key = "content.rich.navigationUnavailable";
        else if (!result.found || !record) key = "content.rich.navigationMiss";
        else {
          const target = { query: action.headword, fragment: action.fragment, ...identity };
          if (!show(record, token, target)) return;
          currentRecord = record;
          if (index === null) {
            history = history.slice(0, cursor + 1); history.push(target);
            if (history.length > 20) history.shift(); cursor = history.length - 1;
          } else cursor = index;
        }
      } catch { if (live() && token === generation) key = "content.rich.navigationUnavailable"; }
      finally {
        if (live() && token === generation) {
          pending = null;
          if (key) { show(currentRecord, token, history[cursor]); if (history[cursor].fragment) actions.locate(fragmentHosts(fragmentRecords.get(history[cursor])), history[cursor].fragment); }
          update(key);
          if (!key && history[cursor].fragment) locate(history[cursor].fragment, fragmentRecords.get(history[cursor]));
        }
      }
    }
    back.addEventListener("click", () => { if (cursor > 0) void navigate({ kind: "entry", headword: history[cursor - 1].query, fragment: history[cursor - 1].fragment }, cursor - 1); });
    forward.addEventListener("click", () => { if (cursor < history.length - 1) void navigate({ kind: "entry", headword: history[cursor + 1].query, fragment: history[cursor + 1].fragment }, cursor + 1); });
    function close() { if (closed) return; closed = true; cancelPending(); history = []; cursor = -1; hosts = []; currentRecord = null; card.releaseNavigation?.(); toolbar.remove(); }
    const runtime = Object.freeze({ navigate, rendered(value) { hosts = value; },
      opened() { if (live() && !pending && history[cursor]?.fragment) { update(); locate(history[cursor].fragment, fragmentRecords.get(history[cursor])); } },
      close,
      get snapshot() { return { history: history.map((item) => ({ ...item })), cursor, pending: Boolean(pending), closed }; } });
    card.bindNavigation?.(runtime); update(); return runtime;
  }
  app.modules.richNavigation = Object.freeze({ create });
})();
