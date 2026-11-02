#!/usr/bin/env python3
"""Copy Git-visible source + working edits, never .git or local game data.

No init, commit, remote mutation or deletion. Manifest stays outside the snapshot.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

DENIED_PARTS = {'.git', '.venv', 'venv', 'node_modules', 'dist', '__pycache__', '.pytest_cache',
                '.cache', '.aws', '.ssh', '.codex', '.agents', 'uploads', 'backup', 'backups', 'data', 'artifacts', 'test-results', 'playwright-report'}
DENIED_SUFFIXES = ('.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite3', '.sql', '.sql.gz', '.dump',
                   '.backup', '.pem', '.key', '.log', '.tmp', '.zip', '.tar.gz', '.pyc', '.pyo')
SECRETS = [re.compile(rb'gh[pousr]_[A-Za-z0-9]{30,}'), re.compile(rb'github_pat_[A-Za-z0-9_]{30,}'),
           re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
           re.compile(rb'AKIA[0-9A-Z]{16}')]


def audit(relative, data):
    p = Path(relative)
    filename = p.name.lower()
    if any(part.lower() in DENIED_PARTS or part.lower().startswith('.venv-') for part in p.parts):
        raise ValueError(f'Private/generated path: {relative}')
    if filename in {'claude.md', 'gm_key.txt', '.npmrc', '.netrc', '.pypirc', 'id_rsa', 'id_ed25519'} or filename.endswith(DENIED_SUFFIXES):
        raise ValueError(f'Private/generated filename: {relative}')
    if filename.startswith('.env') and not filename.endswith('.example'):
        raise ValueError(f'Local environment file: {relative}')
    if b'\0' in data:
        raise ValueError(f'Unexpected binary, review explicitly before migration: {relative}')
    if any(pattern.search(data) for pattern in SECRETS):
        # Report filename only, never the credential value.
        raise ValueError(f'Possible credential, manual review required: {relative}')


def prepare(source, destination):
    source, destination = source.resolve(), destination.resolve()
    if destination == source or source in destination.parents:
        raise ValueError('Destination must be outside the active repository')
    if destination.exists() or destination.with_suffix('.manifest.json').exists():
        raise ValueError('Use a new, nonexistent destination; nothing is overwritten')
    if Path(subprocess.check_output(['git', '-C', str(source), 'rev-parse', '--show-toplevel'], text=True).strip()).resolve() != source:
        raise ValueError('Source must be the root of a Git checkout; use manifest-snapshot.py for a source-only snapshot')
    initial_head = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    candidates = subprocess.check_output(['git', '-C', str(source), 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).split(b'\0')
    records = []
    for item in sorted(set(candidates)):
        if not item:
            continue
        name = item.decode()
        # Optional local instructions must never enter a new initial snapshot,
        # even when the old repository still tracks them. Leave source untouched.
        if name == 'CLAUDE.md':
            continue
        path = source / name
        if path.is_symlink():
            raise ValueError(f'Symlink requires explicit review: {name}')
        if not path.exists():  # Respect tracked deletions in the working tree.
            continue
        data = path.read_bytes()
        audit(name, data)
        records.append({'path': name, 'sha256': hashlib.sha256(data).hexdigest(),
                        'mode': path.stat().st_mode & 0o777})
    destination.mkdir(parents=True)
    for record in records:
        target = destination / record['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / record['path'], target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != record['sha256']:
            raise ValueError(f'Source changed while copying: {record["path"]}')
    # Detect edits/additions/deletions during the copy, without changing source Git.
    final_candidates = subprocess.check_output(['git', '-C', str(source), 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).split(b'\0')
    if set(final_candidates) != set(candidates) or subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() != initial_head:
        raise ValueError('Source changed during copy; partial destination is not a verified snapshot')
    for record in records:
        path = source / record['path']
        if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256'] or path.stat().st_mode & 0o777 != record['mode']:
            raise ValueError(f'Source changed during copy: {record["path"]}')
    report = {'base_head': initial_head,
              'source_status': subprocess.check_output(['git', '-C', str(source), 'status', '--short'], text=True),
              'files': records, 'has_git_directory': (destination / '.git').exists(),
              'secret_scan': 'known credential signatures + path rules; manual review still required',
              'commit_created': False}
    destination.with_suffix('.manifest.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(f'Prepared {len(records)} files at {destination}; no .git or commit created')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    prepare(args.source, args.destination)
