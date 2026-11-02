"""Fail closed on incomplete Chromium reports or results for another run/commit."""
import argparse
import json
import os
from pathlib import Path
import re
import urllib.request
import xml.etree.ElementTree as ET

GROUP_COUNTS = {'sheets': 8, 'tokens': 8, 'scenes': 5, 'interaction': 7}
SHA = re.compile(r'[0-9a-f]{40}')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def browser_evidence(group, sha, run_id, attempt, report):
    require(SHA.fullmatch(sha), 'Invalid tested SHA')
    require(str(run_id).isdigit() and str(attempt).isdigit(), 'Missing run identity')
    root = ET.parse(report).getroot()
    cases = root.findall('.//testcase')
    require(len(cases) == GROUP_COUNTS[group], f'Wrong test count for {group}: {len(cases)}')
    require(not any(root.findall(f'.//{tag}') for tag in ('failure', 'error', 'skipped')), 'Failed or skipped browser tests')
    for suite in root.iter('testsuite'):
        require(all(int(suite.get(k, '0')) == 0 for k in ('failures', 'errors', 'skipped', 'disabled')), 'Unsuccessful browser suite')
    return {'group': group, 'sha': sha, 'run_id': str(run_id), 'attempt': str(attempt), 'passed': len(cases)}


def validate(needs, records, run_id, attempt, candidate=''):
    require(set(needs) == {'resolve', 'backend', 'frontend', 'browser'}, 'Missing required job')
    require(all(job.get('result') == 'success' for job in needs.values()), 'Required job failed, skipped or cancelled')
    sha = needs['resolve']['outputs'].get('sha', '')
    require(SHA.fullmatch(sha), 'Missing resolved SHA')
    require(needs['resolve']['outputs'].get('full') == 'true', 'Fast/draft checks cannot satisfy CI required')
    if candidate:
        require(candidate == sha, 'Candidate must be the exact tested SHA')
    for job in ('backend', 'frontend'):
        outputs = needs[job]['outputs']
        require(outputs.get('tested_sha') == sha, f'{job} SHA mismatch')
        require(outputs.get('run_id') == str(run_id) and outputs.get('attempt') == str(attempt), f'{job} stale run or attempt')
    require(len(records) == len(GROUP_COUNTS), 'Missing or duplicate Chromium evidence')
    require({r.get('group') for r in records} == set(GROUP_COUNTS), 'Missing or duplicate Chromium group')
    for record in records:
        require(record.get('sha') == sha, 'Stale Chromium SHA')
        require(record.get('run_id') == str(run_id) and record.get('attempt') == str(attempt), 'Stale Chromium run or attempt')
        require(record.get('passed') == GROUP_COUNTS[record['group']], 'Incomplete Chromium group')
    return sha


def check_current(event_name, event, sha, candidate, request):
    """A previous PR head/base or an obsolete master run cannot turn the gate green."""
    if event_name == 'pull_request':
        old = event['pull_request']
        live = request(f"pulls/{event['number']}")
        require(live['state'] == 'open' and not live['draft'], 'PR is closed or draft')
        require(live['head']['sha'] == old['head']['sha'], 'PR head changed during checks')
        require(live['base']['sha'] == old['base']['sha'], 'PR base changed during checks')
        require(live['merge_commit_sha'] == sha, 'PR merge commit is stale')
    elif event_name == 'push' and not candidate:
        ref = event['ref']
        require(ref.startswith('refs/heads/'), 'Unexpected push target')
        live = request('git/ref/' + ref.removeprefix('refs/'))
        require(live['object']['sha'] == sha == event['after'], 'Branch advanced during checks')


def github_request(path):
    repo = os.environ['GITHUB_REPOSITORY']
    request = urllib.request.Request(
        f"{os.environ.get('GITHUB_API_URL', 'https://api.github.com')}/repos/{repo}/{path}",
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    evidence = commands.add_parser('evidence')
    evidence.add_argument('--group', choices=GROUP_COUNTS, required=True)
    evidence.add_argument('--sha', required=True)
    evidence.add_argument('--junit', type=Path, required=True)
    evidence.add_argument('--out', type=Path, required=True)
    gate = commands.add_parser('gate')
    gate.add_argument('--evidence-dir', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'evidence':
        result = browser_evidence(args.group, args.sha, os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'], args.junit)
        args.out.write_text(json.dumps(result) + '\n')
    else:
        records = [json.loads(path.read_text()) for path in args.evidence_dir.rglob('evidence.json')]
        candidate = os.environ.get('CI_CANDIDATE', '')
        sha = validate(json.loads(os.environ['CI_NEEDS']), records, os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'], candidate)
        check_current(os.environ['GITHUB_EVENT_NAME'], json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()), sha, candidate, github_request)
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f'tested_sha={sha}\n')
        print(f'Full CI passed for {sha}; all four Chromium groups belong to this run and attempt.')


if __name__ == '__main__':
    main()
