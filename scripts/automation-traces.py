"""Build a local HTML gallery from Playwright's actual screencast frames.

Never extract archive paths. Only frame JPEG/PNG bytes are copied to generated
names; traces belong to isolated mock regression, not the real credential run.
"""
import html
import json
import pathlib
import sys
import zipfile


def build_gallery(trace_root, report_root):
    roots = trace_root if isinstance(trace_root, list) else [trace_root]
    report_root = pathlib.Path(report_root)
    images = report_root / "screenshots"
    gallery = report_root / "regression"
    images.mkdir(exist_ok=True)
    gallery.mkdir(exist_ok=True)
    sections, frames, total = [], 0, 0
    archives = [archive for root in roots for archive in sorted(pathlib.Path(root).glob("**/trace.zip"))]
    for case, archive in enumerate(archives, 1):
        cards = []
        with zipfile.ZipFile(archive) as source:
            for name in sorted(source.namelist()):
                if not name.startswith("screencast/") or pathlib.PurePosixPath(name).suffix not in (".jpeg", ".png"):
                    continue
                info = source.getinfo(name)
                if info.file_size > 16 * 1024 * 1024 or total + info.file_size > 1024**3:
                    raise ValueError("Screenshot gallery exceeded its bounded size")
                total += info.file_size
                frames += 1
                filename = f"reg-{case:03d}-{len(cards)+1:04d}{pathlib.PurePosixPath(name).suffix}"
                (images / filename).write_bytes(source.read(name))
                cards.append(f'<figure><img loading="lazy" src="../screenshots/{filename}" alt="真实轨迹截图 {len(cards)+1}"><figcaption>轨迹帧 {len(cards)+1}</figcaption></figure>')
        if cards:
            title = html.escape(archive.parent.name)
            sections.append(f'<details><summary>{title} · {len(cards)} 张轨迹截图</summary>{"".join(cards)}</details>')
    document = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>浏览器回归截图轨迹</title><style>body{font:16px/1.6 system-ui;background:#f6f3eb;color:#293b31;max-width:1200px;padding:24px;margin:auto}summary{cursor:pointer;padding:16px;background:#e9eee1;overflow-wrap:anywhere}details{margin:16px 0;border:1px solid #d7ddcf;border-radius:12px;overflow:hidden}figure{padding:16px;margin:0;background:#fffdf8}img{max-width:100%;height:auto;border:1px solid #ddd}a{color:#426c4b}</style><a href="../index.html">← 返回验收总览</a><h1>完整浏览器回归 · 截图轨迹</h1><p>来自 Playwright --trace=on 的真实浏览器帧，按用例展开查看。帧图属于模拟回归，不能证明真实服务／私有词典成功；场景通过、失败、跳过以总览中的原始日志为准。这里没有伪造无界面步骤截图，也不把帧数量当作通过数量。</p>'''
    document += f"<p>{len(sections)} 次用例执行含截图轨迹（含定向复验），共 {frames} 帧。</p>" + "".join(sections) + "</html>"
    (gallery / "index.html").write_text(document)
    return {"casesWithFrames": len(sections), "frames": frames, "bytes": total}


if __name__ == "__main__":
    roots = json.loads(sys.argv[1]) if sys.argv[1].startswith("[") else sys.argv[1]
    print(json.dumps(build_gallery(roots, sys.argv[2])))
