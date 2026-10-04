import { useCallback, useEffect, useRef, useState } from "react";
import { dictionaryClient, type DictionaryClient, type DictionarySnapshot } from "./dictionary-client";
import { BundledList, CuratedList, InstalledPackList, OfficialList, RichList } from "./DictionaryViews";
import { LocalDictionaryImport } from "./LocalDictionaryImport";

export function DictionarySection({ client, setStatus }: {
  client: DictionaryClient;
  setStatus: (message: string, error?: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<DictionarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const next = await client.load();
      if (mounted.current && request === generation.current) setSnapshot(next);
    } catch (cause) {
      if (mounted.current && request === generation.current) setError(cause instanceof Error ? cause.message : "读取词典库失败。");
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    const changed = () => { void refresh(); };
    document.addEventListener("translateflow:dictionary-state-changed", changed);
    void refresh();
    return () => {
      mounted.current = false; generation.current += 1;
      document.removeEventListener("translateflow:dictionary-state-changed", changed);
      client.dispose();
    };
  }, [client, refresh]);

  const content = snapshot ? <>
    <div className="dictionary-library-group" aria-labelledby="dictionaryBuiltInHeading">
      <h3 id="dictionaryBuiltInHeading">内置词典</h3><p className="hint">随扩展提供的小型离线词典。这里显示版本、记录数和健康状态。</p>
      <BundledList packs={snapshot.bundled} />
      <details className="dictionary-repair-help"><summary>源码开发安装修复说明</summary><p>从源码加载扩展时，真实词典资源不会提交到 Git。若状态显示资源缺失，请运行 <code>npm run setup:lexicon</code>，完成后在 <code>chrome://extensions</code> 重新加载扩展。</p></details>
    </div>
    <div className="dictionary-library-group" aria-labelledby="dictionaryDownloadHeading">
      <h3 id="dictionaryDownloadHeading">精选上游与官方词典</h3><p className="hint">每项会分别标示上游版本、词典内容日期、TranslateFlow 兼容性审核与下载大小。下载只在你主动操作后进行。</p>
      <h4>官方词典</h4><p className="hint">只有通过来源、再分发许可、质量审核与发布签名的词典才会标为官方。当前没有符合条件的官方词典。</p>
      <OfficialList client={client} snapshot={snapshot} refresh={refresh} setStatus={setStatus} />
      <h4>精选上游</h4><p className="hint">直接从固定的上游版本下载，并由 TranslateFlow 在本机按审核规则转换。内容属于上游 / 社区，不代表 TranslateFlow 官方背书或重新授权。</p>
      <CuratedList client={client} snapshot={snapshot} refresh={refresh} setStatus={setStatus} />
      <div className="actions"><button id="refreshDictionaryPacks" type="button" disabled={loading} onClick={() => void refresh()}>重新检查词典状态</button></div>
      <p className="hint">下载或更新失败不会替换最后一个健康版本；文件缺失、损坏和版本不兼容会显示为不同状态。</p>
    </div>
    <div className="dictionary-library-group" aria-labelledby="dictionaryInstalledHeading">
      <h3 id="dictionaryInstalledHeading">已安装</h3><p className="hint">这里列出已安装的额外词典，包含来源、兼容状态、本地版本、占用空间和管理操作。</p>
      <h4>词典包与本地词典</h4><InstalledPackList client={client} snapshot={snapshot} refresh={refresh} setStatus={setStatus} />
      <h4>富文本词典</h4><p className="hint">划词展示顺序中第一本已启用的富文本词典是你的个人首选，并会优先展开。你可以随时调整；这只是个人显示偏好，不代表 TranslateFlow 的推荐或官方背书。</p>
      <RichList client={client} dictionaries={snapshot.rich} refresh={refresh} setStatus={setStatus} />
    </div>
  </> : null;

  return <section id="dictionary-packs" tabIndex={-1}>
    <h2>词典库</h2><p className="section-summary">本地查词始终优先于 AI。内置词典随扩展提供；下载词典和本地导入只会在你主动操作后保存到浏览器中。</p>
    {error && !snapshot ? <div className="dictionary-library-group"><p role="alert">读取词典库失败：{error}</p><button type="button" onClick={() => void refresh()}>重试</button></div> : content}
    {!snapshot && !error ? <div className="dictionary-library-group" aria-busy="true">正在读取词典库…</div> : null}
    {error && snapshot ? <p role="alert">重新检查词典状态失败：{error}</p> : null}
    <div className="dictionary-library-group" aria-labelledby="dictionaryImportHeading">
      <h3 id="dictionaryImportHeading">本地导入</h3><p className="hint">本地文件按不可信数据处理；导入不会赋予或暗示任何再分发权利，也不会自动调用 Provider / AI。</p>
      <LocalDictionaryImport setStatus={setStatus} onChanged={refresh} />
    </div>
  </section>;
}

export function createDictionaryClient() { return dictionaryClient(); }
