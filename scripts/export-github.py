#!/usr/bin/env python3
"""Read-only GitHub metadata/asset export. Requires owner-authorized gh login.

Run outside the repository. No remote writes. Partial exports fail, never claim success.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def api(repo, endpoint, paginated=False):
    args = ['gh', 'api', f'repos/{repo}/{endpoint}'.rstrip('/')]
    if paginated:
        args += ['--paginate', '--slurp']
    data = json.loads(subprocess.check_output(args))
    return [item for page in data for item in page] if paginated else data


def ensure_private_output(out):
    if any((parent / '.git').exists() for parent in (out, *out.parents)):
        raise ValueError('Export must be outside any Git working tree')


def export(repo, out):
    out = out.resolve()
    ensure_private_output(out)
    out.mkdir(parents=True, exist_ok=False)
    out.chmod(0o700)
    def save(name, data):
        (out / f'{name}.json').write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    save('repository', api(repo, ''))
    for endpoint in ['labels', 'milestones?state=all', 'issues?state=all', 'pulls?state=all',
                     'releases', 'hooks', 'rulesets', 'branches']:
        name = endpoint.split('?')[0].replace('/', '-')
        save(name, api(repo, endpoint, True))
    for endpoint, key in [('actions/workflows', 'workflows'), ('environments', 'environments')]:
        # Preserve every page of the object-shaped collection, not just the first 30.
        pages = json.loads(subprocess.check_output(['gh', 'api', f'repos/{repo}/{endpoint}?per_page=100', '--paginate', '--slurp']))
        items = [item for page in pages for item in page[key]]
        if pages and len(items) != pages[0]['total_count']:
            raise ValueError(f'Incomplete collection: {endpoint}')
        save(endpoint.replace('/', '-'), items)
    for ruleset in json.loads((out / 'rulesets.json').read_text()):
        save(f'ruleset-{int(ruleset["id"])}', api(repo, f'rulesets/{int(ruleset["id"])}'))
    from urllib.parse import quote
    for branch in json.loads((out / 'branches.json').read_text()):
        if branch['protected']:
            # A permission failure is fatal; never label a protected branch unprotected.
            save('branch-protection-' + quote(branch['name'], safe=''), api(repo, 'branches/' + quote(branch['name'], safe='') + '/protection'))
    issues = json.loads((out / 'issues.json').read_text())
    pulls = json.loads((out / 'pulls.json').read_text())
    for issue in issues:
        number = int(issue['number'])
        for suffix in ['comments', 'events']:
            save(f'issue-{number}-{suffix}', api(repo, f'issues/{number}/{suffix}', True))
    for pull in pulls:
        number = int(pull['number'])
        save(f'pull-{number}', api(repo, f'pulls/{number}'))
        for suffix in ['reviews', 'comments', 'commits', 'files']:
            save(f'pull-{number}-{suffix}', api(repo, f'pulls/{number}/{suffix}', True))
    for release in json.loads((out / 'releases.json').read_text()):
        folder = out / f'release-{int(release["id"])}'
        folder.mkdir()
        assets = api(repo, f'releases/{int(release["id"])}/assets', True)
        save(f'release-{int(release["id"])}-assets', assets)
        for asset in assets:
            # Use numeric IDs for paths; asset names remain in releases.json.
            path = folder / str(int(asset['id']))
            with path.open('wb') as handle:
                subprocess.run(['gh', 'api', '-H', 'Accept: application/octet-stream',
                                f'repos/{repo}/releases/assets/{int(asset["id"])}'], stdout=handle, check=True)
            if path.stat().st_size != asset['size']:
                raise ValueError(f'Incomplete release asset {asset["id"]}')
            digest = asset.get('digest')
            if digest and digest.startswith('sha256:') and hashlib.sha256(path.read_bytes()).hexdigest() != digest.split(':', 1)[1]:
                raise ValueError(f'Release asset digest mismatch {asset["id"]}')
    checksums = {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in out.rglob('*') if p.is_file()}
    (out / 'COMPLETE.json').write_text(json.dumps({'repo': repo, 'sha256': checksums}, indent=2) + '\n')
    print(f'Export complete: {out}. Secret values and GitHub configuration restore are not included.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    export(args.repository, args.output)
