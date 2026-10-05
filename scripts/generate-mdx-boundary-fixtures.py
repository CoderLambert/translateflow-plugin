#!/usr/bin/env python3
"""Generate synthetic raw-boundary fixtures with the pinned independent writer.

No production parser or test fixture encoder participates in generation.
Uses the same pinned date and Python compatibility shim as MDD interop.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--writer-checkout', required=True)
    parser.add_argument('--out-dir', required=True)
    args = parser.parse_args()
    checkout = Path(args.writer_checkout).resolve()
    writer_sha = hashlib.sha256((checkout / 'writemdict.py').read_bytes()).hexdigest()
    if writer_sha != 'f47452af9296b79d8f4fc39e0432d72278079857482bc6d74b1b5e35e4b65081':
        raise SystemExit('Independent writer source checksum mismatch')
    spec = importlib.util.spec_from_file_location(
        'interop', Path(__file__).with_name('generate-mdd-interop-fixture.py'))
    interop = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(interop)
    writer = interop.import_writer(checkout)
    output = Path(args.out_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    cases = [
        ('single-c.mdx', 'utf8', False, {'C': '<p>Uppercase sentinel</p>'}),
        ('writer-utf8.mdx', 'utf8', False, {
            'C': '<p>Uppercase sentinel</p>', 'co-op': '<p>Punctuation sentinel</p>',
            'Ｆoo': '<p>Width sentinel</p>', 'Zebra': '<p>Last sentinel</p>'}),
        ('writer-utf16.mdx', 'utf16', False, {
            'C': '<p>Uppercase sentinel</p>', 'co-op': '<p>Punctuation sentinel</p>',
            'Ｆoo': '<p>Width sentinel</p>', 'Zebra': '<p>Last sentinel</p>'}),
        ('writer-encrypted.mdx', 'utf8', True, {'C': '<p>Encrypted sentinel</p>'}),
    ]
    files = []
    for name, encoding, encrypted, entries in cases:
        path = output / name
        with path.open('wb') as target:
            writer(entries, title='Synthetic MDX boundary fixture',
                   description='Synthetic interoperability test, not dictionary corpus',
                   encoding=encoding, version='2.0', block_size=16,
                   encrypt_index=encrypted).write(target)
        data = path.read_bytes()
        files.append({'file': name, 'bytes': len(data),
                      'sha256': hashlib.sha256(data).hexdigest(),
                      'encoding': encoding, 'encrypted': encrypted,
                      'entries': list(entries)})
    lock = {'schemaVersion': 1, 'purpose': 'synthetic-raw-key-boundary-regression',
            'writerRepository': 'https://github.com/zhansliu/writemdict',
            'writerCommit': interop.WRITER_COMMIT, 'writerSha256': writer_sha,
            'license': 'MIT', 'headerDate': '2026-09-30',
            'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'files': files}
    (output / 'corpus-lock.json').write_text(
        json.dumps(lock, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    main()
