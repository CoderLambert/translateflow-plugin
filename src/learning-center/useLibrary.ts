import { useCallback, useEffect, useRef, useState } from "react";
import { ReadingError } from "./client/reading";
import type { ReadingClient, RecordItem, PageItem } from "./client/reading";
export function useLibrary(client: ReadingClient, mode: "recent" | "pages", query: string, pageKey: string | null, revision: number, enabled: boolean) {
  const [records, setRecords] = useState<RecordItem[]>([]), [pages, setPages] = useState<PageItem[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(false), [stale, setStale] = useState(false);
  const epoch = useRef(0), pending = useRef(false);
  const load = useCallback(async (continuation: string | null = null) => {
    const generation = ++epoch.current; pending.current = true; setLoading(true); setError(false);
    try {
      if (mode === "pages") {
        const result = await client.pages(query, continuation);
        if (epoch.current === generation) { setPages(old => continuation ? [...old, ...result.items] : result.items); setCursor(result.nextCursor); }
      } else {
        const result = await client.records(query, pageKey, continuation);
        if (epoch.current === generation) { setRecords(old => continuation ? [...old, ...result.items] : result.items); setCursor(result.nextCursor); }
      }
    } catch (failure) {
      if (epoch.current === generation) {
        if (continuation && failure instanceof ReadingError && failure.code === "READING_STALE_OPERATION") { setStale(true); void load(); }
        else setError(true);
      }
    } finally { if (epoch.current === generation) { pending.current = false; setLoading(false); } }
  }, [client, mode, query, pageKey]);
  useEffect(() => {
    epoch.current++; setRecords([]); setPages([]); setCursor(null); setError(false); setStale(false); pending.current = false;
    if (enabled) void load();
    return () => { epoch.current++; pending.current = false; };
  }, [load, revision, enabled]);
  return { records, pages, loading, error, stale, more: cursor !== null,
    next: () => { if (!pending.current && cursor) void load(cursor); }, retry: () => { void load(); } };
}
