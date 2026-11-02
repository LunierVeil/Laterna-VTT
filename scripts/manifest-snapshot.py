#!/usr/bin/env python3
"""Audit a source-only directory and write its manifest outside it, without Git."""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

# A manifest audit must not create bytecode inside the snapshot it audits.
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('source_audit', Path(__file__).with_name('prepare-repository.py'))
audit_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_module)


def generate(source, output):
    source, output = source.resolve(), output.resolve()
    if source == output or source in output.parents:
        raise ValueError('Manifest must stay outside source')
    records = []
    for path in sorted(source.rglob('*')):
        if path.is_symlink() or path.name.lower() == '.git':
            raise ValueError(f'Git metadata or symlink: {path.relative_to(source)}')
        if not path.is_file():
            continue
        name = str(path.relative_to(source))
        data = path.read_bytes()
        audit_module.audit(name, data)
        records.append({'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'mode': path.stat().st_mode & 0o777})
    result = {'format': 1, 'files': records, 'has_git_directory': False, 'commit_created': False,
              'description': 'Cleaned source snapshot before Initial Commit; no Git history'}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f'Manifest: {len(records)} files; no Git operations')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    generate(args.source, args.output)
