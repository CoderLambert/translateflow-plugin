#!/usr/bin/env python3
"""
Build a personal, rich MDict source from the full ECDICT CSV plus optional
English↔Mandarin Tatoeba examples.

The output is an MDict source text file consumable by mdict-utils:

    mdict --title title.html --description description.html \
      -a dictionary.txt dictionary.mdx

Dictionary facts remain source-driven. This script only performs deterministic
projection, presentation and example selection.
"""

from __future__ import annotations

import argparse
import bz2
import csv
import html
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Iterable

TITLE = "TranslateFlow Personal English-Chinese"
VERSION = "1.0"
MAX_FIELD_CHARS = 16000
WORD_RE = re.compile(r"[A-Za-z]+(?:[’'-][A-Za-z]+)*")
SAFE_HEADWORD_RE = re.compile(r"^[^\r\n\t<>]{1,240}$")
SINGLE_WORD_RE = re.compile(r"^[A-Za-z]+(?:[’'-][A-Za-z]+)*$")

POS_LABELS = {
    "n": "名词",
    "v": "动词",
    "vi": "不及物动词",
    "vt": "及物动词",
    "a": "形容词",
    "adj": "形容词",
    "ad": "副词",
    "adv": "副词",
    "prep": "介词",
    "conj": "连词",
    "pron": "代词",
    "num": "数词",
    "art": "冠词",
    "aux": "助动词",
    "int": "感叹词",
}

TAG_LABELS = {
    "zk": "中考",
    "gk": "高考",
    "cet4": "CET-4",
    "cet6": "CET-6",
    "ky": "考研",
    "ielts": "IELTS",
    "toefl": "TOEFL",
    "gre": "GRE",
    "tem4": "TEM-4",
    "tem8": "TEM-8",
}

EXCHANGE_LABELS = {
    "p": "过去式",
    "d": "过去分词",
    "i": "现在分词",
    "3": "第三人称单数",
    "r": "比较级",
    "t": "最高级",
    "s": "复数",
    "0": "原形",
    "1": "原形变化类型",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ecdict", required=True, type=Path)
    parser.add_argument("--eng-sentences", type=Path)
    parser.add_argument("--cmn-sentences", type=Path)
    parser.add_argument("--links", type=Path)
    parser.add_argument("--source-out", required=True, type=Path)
    parser.add_argument("--resource-dir", required=True, type=Path)
    parser.add_argument("--metadata-dir", required=True, type=Path)
    parser.add_argument("--example-headwords", type=int, default=50000)
    parser.add_argument("--max-examples", type=int, default=2)
    return parser.parse_args()


def text(value: object, limit: int = MAX_FIELD_CHARS) -> str:
    value = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return value[:limit]


def positive_int(value: object) -> int:
    try:
        number = int(str(value or "").strip())
    except ValueError:
        return 0
    return number if number > 0 else 0


def lexical_priority(row: dict[str, str]) -> tuple[int, int, int, str]:
    bnc = positive_int(row.get("bnc"))
    frq = positive_int(row.get("frq"))
    collins = positive_int(row.get("collins"))
    oxford = 1 if str(row.get("oxford") or "").strip() == "1" else 0
    frequency = min([n for n in (bnc, frq) if n] or [10**9])
    editorial = 0 if oxford else 1
    collins_rank = -collins
    return frequency, editorial, collins_rank, text(row.get("word")).casefold()


def collect_example_targets(ecdict: Path, limit: int) -> set[str]:
    candidates: list[tuple[tuple[int, int, int, str], str]] = []
    with ecdict.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            word = text(row.get("word"))
            if not SINGLE_WORD_RE.fullmatch(word):
                continue
            if not text(row.get("translation")) and not text(row.get("definition")):
                continue
            candidates.append((lexical_priority(row), word.casefold()))
    candidates.sort(key=lambda item: item[0])
    return {word for _, word in candidates[:limit]}


def bz2_lines(path: Path) -> Iterable[str]:
    with bz2.open(path, "rt", encoding="utf-8", errors="replace") as handle:
        yield from handle


def build_examples(
    targets: set[str],
    eng_sentences: Path | None,
    cmn_sentences: Path | None,
    links: Path | None,
    max_examples: int,
) -> dict[str, list[tuple[str, str]]]:
    if not targets or not eng_sentences or not cmn_sentences or not links:
        return {}
    if not all(path.exists() for path in (eng_sentences, cmn_sentences, links)):
        return {}

    eng_to_cmn: dict[int, list[int]] = defaultdict(list)
    needed_cmn_ids: set[int] = set()
    for line in bz2_lines(links):
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 2:
            continue
        try:
            eng_id, cmn_id = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        if len(eng_to_cmn[eng_id]) < 3:
            eng_to_cmn[eng_id].append(cmn_id)
            needed_cmn_ids.add(cmn_id)

    cmn_text: dict[int, str] = {}
    for line in bz2_lines(cmn_sentences):
        parts = line.rstrip("\n").split("\t", 2)
        if len(parts) < 3:
            continue
        try:
            sentence_id = int(parts[0])
        except ValueError:
            continue
        if sentence_id not in needed_cmn_ids:
            continue
        sentence = text(parts[2], 300)
        if 2 <= len(sentence) <= 220:
            cmn_text[sentence_id] = sentence

    examples: dict[str, list[tuple[str, str]]] = defaultdict(list)
    remaining = set(targets)
    for line in bz2_lines(eng_sentences):
        if not remaining:
            break
        parts = line.rstrip("\n").split("\t", 2)
        if len(parts) < 3:
            continue
        try:
            sentence_id = int(parts[0])
        except ValueError:
            continue
        linked = eng_to_cmn.get(sentence_id)
        if not linked:
            continue
        english = text(parts[2], 360)
        token_count = len(WORD_RE.findall(english))
        if token_count < 4 or token_count > 24 or len(english) < 18 or len(english) > 220:
            continue
        chinese = next((cmn_text.get(cmn_id) for cmn_id in linked if cmn_text.get(cmn_id)), "")
        if not chinese:
            continue
        tokens = {match.group(0).casefold() for match in WORD_RE.finditer(english)}
        matched = tokens.intersection(remaining)
        if not matched:
            continue
        for token in matched:
            bucket = examples[token]
            if len(bucket) < max_examples and all(existing[0] != english for existing in bucket):
                bucket.append((english, chinese))
            if len(bucket) >= max_examples:
                remaining.discard(token)
    return dict(examples)


def split_lines(value: str, max_items: int = 12) -> list[str]:
    lines: list[str] = []
    for raw in text(value).split("\n"):
        line = raw.strip()
        if line and line not in lines:
            lines.append(line)
        if len(lines) >= max_items:
            break
    return lines


def parse_pos(value: str) -> list[tuple[str, int | None]]:
    result: list[tuple[str, int | None]] = []
    for item in text(value).split("/"):
        item = item.strip()
        if not item:
            continue
        if ":" in item:
            key, raw_pct = item.split(":", 1)
            try:
                pct = int(raw_pct)
            except ValueError:
                pct = None
        else:
            key, pct = item, None
        key = key.strip()
        result.append((POS_LABELS.get(key, key), pct))
    return result[:8]


def parse_exchange(value: str) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for item in text(value).split("/"):
        if ":" not in item:
            continue
        kind, form = item.split(":", 1)
        kind = kind.strip()
        form = form.strip()
        if form and SAFE_HEADWORD_RE.fullmatch(form):
            result.append((EXCHANGE_LABELS.get(kind, kind), form))
    return result[:14]


def h(value: object) -> str:
    return html.escape(text(value), quote=True)


def entry_link(word: str, label: str | None = None) -> str:
    safe = h(word)
    label = h(label or word)
    return f'<a class="tf-link" href="entry://{safe}">{label}</a>'


def badges(row: dict[str, str]) -> list[str]:
    items: list[str] = []
    collins = positive_int(row.get("collins"))
    if collins:
        items.append(f'<span class="tf-badge tf-badge-strong">Collins {"★" * min(collins, 5)}</span>')
    if str(row.get("oxford") or "").strip() == "1":
        items.append('<span class="tf-badge tf-badge-strong">Oxford 3000</span>')
    for tag in text(row.get("tag")).split():
        items.append(f'<span class="tf-badge">{h(TAG_LABELS.get(tag.lower(), tag.upper()))}</span>')
    return items[:10]


def render_entry(row: dict[str, str], examples: list[tuple[str, str]]) -> str:
    word = text(row.get("word"))
    phonetic = text(row.get("phonetic"))
    translations = split_lines(row.get("translation") or "", 16)
    definitions = split_lines(row.get("definition") or "", 12)
    pos = parse_pos(row.get("pos") or "")
    exchange = parse_exchange(row.get("exchange") or "")
    bnc = positive_int(row.get("bnc"))
    frq = positive_int(row.get("frq"))

    chunks: list[str] = [
        '<link rel="stylesheet" type="text/css" href="/tf-personal.css"/>',
        '<article class="tf-dict">',
        '<header class="tf-head">',
        f'<div class="tf-word">{h(word)}</div>',
    ]
    if phonetic:
        chunks.append(f'<div class="tf-phonetic">/{h(phonetic)}/</div>')
    badge_html = badges(row)
    if badge_html:
        chunks.append('<div class="tf-badges">' + "".join(badge_html) + '</div>')
    chunks.append('</header>')

    if pos:
        chunks.append('<section class="tf-strip"><span class="tf-label">词性</span>')
        for label, pct in pos:
            suffix = f" {pct}%" if pct is not None else ""
            chunks.append(f'<span class="tf-pos">{h(label)}{suffix}</span>')
        chunks.append('</section>')

    if translations:
        chunks.append('<section class="tf-section"><h2>中文释义</h2><ol class="tf-senses">')
        for item in translations:
            chunks.append(f'<li>{h(item)}</li>')
        chunks.append('</ol></section>')

    if definitions:
        chunks.append('<section class="tf-section tf-english"><h2>English definitions</h2><ol class="tf-senses">')
        for item in definitions:
            chunks.append(f'<li>{h(item)}</li>')
        chunks.append('</ol></section>')

    if examples:
        chunks.append('<section class="tf-section"><h2>双语例句</h2>')
        for english, chinese in examples[:2]:
            chunks.append('<div class="tf-example">')
            chunks.append(f'<div class="tf-example-en">{h(english)}</div>')
            chunks.append(f'<div class="tf-example-zh">{h(chinese)}</div>')
            chunks.append('</div>')
        chunks.append('</section>')

    if exchange:
        chunks.append('<section class="tf-section"><h2>词形变化</h2><div class="tf-forms">')
        for label, form in exchange:
            chunks.append(f'<span class="tf-form"><small>{h(label)}</small>{entry_link(form)}</span>')
        chunks.append('</div></section>')

    if bnc or frq:
        chunks.append('<section class="tf-strip tf-frequency"><span class="tf-label">词频</span>')
        if frq:
            chunks.append(f'<span>现代语料 #{frq:,}</span>')
        if bnc:
            chunks.append(f'<span>BNC #{bnc:,}</span>')
        chunks.append('</section>')

    detail = text(row.get("detail"), 8000)
    if detail:
        try:
            parsed = json.loads(detail)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            notes: list[str] = []
            for key in ("note", "notes", "usage", "example"):
                value = parsed.get(key)
                if isinstance(value, str) and value.strip():
                    notes.append(value.strip())
                elif isinstance(value, list):
                    notes.extend(str(item).strip() for item in value if str(item).strip())
            if notes:
                chunks.append('<section class="tf-section"><h2>补充信息</h2>')
                for note in notes[:4]:
                    chunks.append(f'<p>{h(note)}</p>')
                chunks.append('</section>')

    chunks.append(
        '<footer class="tf-source">ECDICT · Tatoeba examples where available · '
        'generated locally for personal offline lookup</footer>'
    )
    chunks.append('</article>')
    return "".join(chunks)


def write_metadata(metadata_dir: Path) -> None:
    metadata_dir.mkdir(parents=True, exist_ok=True)
    (metadata_dir / "title.html").write_text(
        f"<b>{TITLE}</b>",
        encoding="utf-8",
    )
    (metadata_dir / "description.html").write_text(
        (
            f"<b>{TITLE} v{VERSION}</b><br/>"
            "Full ECDICT bilingual entries with phonetics, POS/frequency metadata, "
            "word forms and selected English↔Mandarin Tatoeba examples. "
            "Built for personal offline use."
        ),
        encoding="utf-8",
    )


def write_resources(resource_dir: Path) -> None:
    resource_dir.mkdir(parents=True, exist_ok=True)
    css = """
.tf-dict{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#243126;line-height:1.55;padding:.25rem .1rem 1rem}
.tf-head{padding:.35rem .1rem .65rem;border-bottom:1px solid rgba(50,85,55,.18)}
.tf-word{font-family:Georgia,"Times New Roman",serif;font-size:2rem;line-height:1.15;font-weight:700;color:#2d5133}
.tf-phonetic{margin-top:.25rem;color:#2f6f86;font-size:1rem}
.tf-badges{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.55rem}
.tf-badge{display:inline-block;padding:.12rem .45rem;border-radius:999px;background:#eef3e9;color:#53634d;font-size:.75rem}
.tf-badge-strong{background:#e2eddc;color:#31543a}
.tf-strip{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;padding:.55rem .1rem;color:#677267;font-size:.82rem}
.tf-label{font-weight:700;color:#465448;margin-right:.2rem}
.tf-pos{padding:.08rem .35rem;border:1px solid rgba(50,85,55,.16);border-radius:.4rem}
.tf-section{padding:.65rem .1rem;border-top:1px solid rgba(50,85,55,.10)}
.tf-section h2{font-size:.9rem;margin:0 0 .45rem;color:#3f5d45}
.tf-senses{margin:.2rem 0 .1rem;padding-left:1.4rem}
.tf-senses li{margin:.25rem 0}
.tf-english{color:#4b5550}
.tf-example{margin:.55rem 0;padding:.55rem .65rem;border-left:3px solid #8faa88;background:rgba(238,243,233,.55);border-radius:.3rem}
.tf-example-en{color:#2d352f}
.tf-example-zh{color:#657069;margin-top:.25rem}
.tf-forms{display:flex;flex-wrap:wrap;gap:.45rem}
.tf-form{display:inline-flex;gap:.3rem;align-items:center;padding:.18rem .45rem;background:rgba(238,243,233,.6);border-radius:.4rem}
.tf-form small{color:#7a857c}
.tf-link{color:#3d7450;text-decoration:none;border-bottom:1px dotted currentColor}
.tf-frequency{border-top:1px solid rgba(50,85,55,.10)}
.tf-source{margin-top:.65rem;color:#8a918b;font-size:.72rem}
"""
    (resource_dir / "tf-personal.css").write_text(css.strip() + "\n", encoding="utf-8")


def build_source(
    ecdict: Path,
    source_out: Path,
    examples: dict[str, list[tuple[str, str]]],
) -> tuple[int, int]:
    source_out.parent.mkdir(parents=True, exist_ok=True)
    entries = 0
    skipped = 0
    seen: set[str] = set()

    with ecdict.open("r", encoding="utf-8-sig", newline="") as handle, \
            source_out.open("w", encoding="utf-8", newline="\n") as out:
        reader = csv.DictReader(handle)
        required = {"word", "phonetic", "definition", "translation", "pos", "collins", "oxford", "tag", "bnc", "frq", "exchange", "detail"}
        if not required.issubset(set(reader.fieldnames or [])):
            missing = sorted(required.difference(set(reader.fieldnames or [])))
            raise RuntimeError(f"ECDICT schema missing columns: {missing}")

        for row in reader:
            word = text(row.get("word"))
            if not word or not SAFE_HEADWORD_RE.fullmatch(word):
                skipped += 1
                continue
            folded = word.casefold()
            if folded in seen:
                skipped += 1
                continue
            if not text(row.get("translation")) and not text(row.get("definition")):
                skipped += 1
                continue
            seen.add(folded)
            body = render_entry(row, examples.get(folded, []))
            out.write(word)
            out.write("\n")
            out.write(body)
            out.write("\n</>\n")
            entries += 1

    return entries, skipped


def main() -> None:
    args = parse_args()
    write_metadata(args.metadata_dir)
    write_resources(args.resource_dir)

    targets = collect_example_targets(args.ecdict, args.example_headwords)
    examples = build_examples(
        targets,
        args.eng_sentences,
        args.cmn_sentences,
        args.links,
        args.max_examples,
    )
    entries, skipped = build_source(args.ecdict, args.source_out, examples)

    report = {
        "title": TITLE,
        "version": VERSION,
        "entries": entries,
        "skipped": skipped,
        "exampleTargets": len(targets),
        "headwordsWithExamples": len(examples),
        "examplePairs": sum(len(value) for value in examples.values()),
    }
    (args.metadata_dir / "build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
