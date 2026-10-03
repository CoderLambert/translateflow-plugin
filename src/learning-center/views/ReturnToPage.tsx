import { useEffect, useRef, useState } from "react";
import type { I18n } from "../../i18n/index.js";
import { readingClient, ReadingError } from "../client/reading";
import type { Detail, ReadingClient, SiteMarkers } from "../client/reading";
import { Button, Notice } from "../components/common";

export function ReturnToPage({ record, i18n, disabled, client = readingClient }: {
  record: Detail["record"]; i18n: I18n; disabled: boolean; client?: ReadingClient;
}) {
  const origin = record.safeReturnUrl ? new URL(record.safeReturnUrl).origin : null;
  const [markers, setMarkers] = useState<SiteMarkers | null>(null), [markerError, setMarkerError] = useState(false);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState<"ready" | "permission-required" | "unsupported" | "error" | "disabled" | "changed" | null>(null);
  const epoch = useRef(0), mutation = useRef(false);
  useEffect(() => {
    const current = ++epoch.current; setMarkers(null); setStatus(null); setMarkerError(false); setBusy(false);
    if (origin) client.markers(origin).then(value => { if (epoch.current === current) setMarkers(value); })
      .catch(() => { if (epoch.current === current) setMarkerError(true); });
    return () => { epoch.current++; };
  }, [client, origin, record.recordId]);
  async function returnToPage(grant = false) {
    if (disabled || mutation.current) return;
    const current = epoch.current; mutation.current = true; setBusy(true); setStatus(null);
    try {
      if (grant && origin && !await client.requestSitePermission(origin)) { if (epoch.current === current) setStatus("permission-required"); return; }
      const result = await client.createHandoff(record.recordId, record.revision);
      if (epoch.current === current) setStatus(result.state);
    } catch (error) {
      if (epoch.current === current) setStatus(error instanceof ReadingError && error.code === "READING_DISABLED" ? "disabled"
        : error instanceof ReadingError && ["READING_REVISION_CONFLICT", "READING_STALE_OPERATION", "READING_NOT_FOUND"].includes(error.code) ? "changed" : "error");
    } finally { mutation.current = false; if (epoch.current === current) setBusy(false); }
  }
  async function toggleMarkers() {
    if (disabled || mutation.current || !origin) return;
    const current = epoch.current, enabled = !markers?.enabled;
    mutation.current = true; setBusy(true); setMarkerError(false);
    try {
      if (enabled && !await client.requestSitePermission(origin)) {
        if (epoch.current === current) setMarkers({ state: "permission-required", enabled: markers?.enabled ?? false, permissionGranted: false });
        return;
      }
      const result = await client.setMarkers(origin, enabled);
      if (epoch.current === current) setMarkers(result);
    } catch { if (epoch.current === current) setMarkerError(true); }
    finally { mutation.current = false; if (epoch.current === current) setBusy(false); }
  }
  return <div className="return-to-page" aria-busy={busy}>
    <div className="actions"><Button disabled={disabled || busy} onClick={event => { if (event.nativeEvent.isTrusted) void returnToPage(); }}>{i18n.t("learning.returnPage")}</Button>
      {status === "permission-required" && origin && <Button disabled={disabled || busy} onClick={event => { if (event.nativeEvent.isTrusted) void returnToPage(true); }}>{i18n.t("learning.grantSiteAccess")}</Button>}
    </div>
    {busy && <Notice>{i18n.t("learning.returnLoading")}</Notice>}
    {status && <Notice error={["error", "disabled", "changed"].includes(status)}>{i18n.t(status === "ready" ? "learning.returnReady" : status === "permission-required" ? "learning.returnPermission"
      : status === "unsupported" ? "learning.returnUnsupported" : status === "disabled" ? "learning.returnDisabled" : status === "changed" ? "learning.changed" : "learning.actionError")}</Notice>}
    {origin && <><Button aria-pressed={markers?.enabled ?? false} disabled={disabled || busy || (!markers && !markerError)} onClick={event => { if (event.nativeEvent.isTrusted) void toggleMarkers(); }}>
      {i18n.t(markers?.enabled ? "learning.disableSiteMarkers" : "learning.enableSiteMarkers")}</Button>
      <p className="muted">{i18n.t("learning.siteMarkersHelp")}</p>
      {markers?.state === "permission-required" && <Notice>{i18n.t("learning.returnPermission")}</Notice>}
      {markerError && <Notice error>{i18n.t("learning.actionError")}</Notice>}
    </>}
    {record.safeReturnUrl && <><a href={record.safeReturnUrl} target="_blank" rel="noopener noreferrer">{i18n.t("learning.openPage")}</a><p className="muted">{i18n.t("learning.openHelp")}</p></>}
  </div>;
}
