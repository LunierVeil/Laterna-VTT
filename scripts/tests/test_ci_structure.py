"""Check the workflow contracts that prevent silently losing a test group."""
import json
from pathlib import Path
import re
import os
import subprocess
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


class WorkflowContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.full = yaml.load((ROOT/'.github/workflows/ci.yml').read_text(), Loader=yaml.BaseLoader)
        cls.fast = yaml.load((ROOT/'.github/workflows/fast-ci.yml').read_text(), Loader=yaml.BaseLoader)
        cls.release = yaml.load((ROOT/'.github/workflows/windows-release.yml').read_text(), Loader=yaml.BaseLoader)

    def test_matrix_covers_every_suite_exactly_once(self):
        groups = self.full['jobs']['browser']['strategy']['matrix']['group']
        runner = (ROOT/'web/tests/browser/run.mjs').read_text()
        inventory = json.loads((ROOT/'web/tests/browser/inventory.json').read_text())
        mapping = inventory['groups']
        self.assertIn("import inventory from './inventory.json'", runner)
        self.assertEqual(set(groups), set(mapping) | {'http-uuid'})
        self.assertEqual(len(groups), len(set(groups)))
        suites = [suite for group in mapping for suite in mapping[group]]
        self.assertEqual(len(suites), len(set(suites)))
        self.assertEqual({f'{s}.test.mjs' for s in suites}, {p.name for p in (ROOT/'web/tests/browser').glob('*.test.mjs')})
        import importlib.util
        spec=importlib.util.spec_from_file_location('gate_counts', ROOT/'scripts/ci_gate.py')
        gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
        http_runner = (ROOT/'web/tests/browser/http-uuid.mjs').read_text()
        http_suites = re.findall(r"await import\('\./([^']+)\.test\.mjs'\)", http_runner)
        self.assertCountEqual(http_suites, ['catalog', 'tokens'])
        self.assertCountEqual(http_suites, inventory['httpSuites'])
        self.assertIn("insecureHttp ? ['http-uuid.mjs']", runner)
        self.assertEqual(set(gate.GROUP_COUNTS), set(groups))
        self.assertEqual(set(suites), set(inventory['suites']))
        for suite in suites:
            source = (ROOT/f'web/tests/browser/{suite}.test.mjs').read_text()
            names = re.findall(r"^test\('([^']+)'", source, re.M)
            self.assertEqual(len(names), len(set(names)), suite)
            self.assertCountEqual(names, inventory['suites'][suite], suite)
        self.assertEqual(sum(gate.GROUP_COUNTS[group] for group in mapping), 38)

    def test_backend_keeps_one_complete_pytest_schedule_and_service_checks(self):
        for workflow in (self.fast, self.full):
            with self.subTest(workflow=workflow['name']):
                steps = workflow['jobs']['backend']['steps']
                runs = [step.get('run', '') for step in steps]
                self.assertIn('python -m pip install -r server/requirements.txt -r server/requirements-ci.txt', runs)
                self.assertIn('python -m unittest discover -s scripts/tests -v', runs)
                pytest = [run for run in runs if 'python -m pytest' in run]
                self.assertEqual(pytest, ['python -m pytest server/tests -q -n 4 --dist loadfile --junitxml=artifacts/backend.xml'])

    def test_build_retains_typecheck_with_frontend_unit_tests(self):
        package = json.loads((ROOT/'web/package.json').read_text())
        self.assertEqual(package['scripts']['build'].split(' && ')[0], package['scripts']['typecheck'])
        for workflow in (self.fast, self.full):
            runs = [step.get('run') for step in workflow['jobs']['frontend']['steps']]
            self.assertIn('npm test', runs)
            self.assertIn('npm run build', runs)
            self.assertNotIn('npm run typecheck', runs)

    def test_full_gate_is_always_and_cannot_export_unchecked_sha(self):
        required = self.full['jobs']['required']
        self.assertEqual(required['if'], 'always()')
        self.assertEqual(set(required['needs']), {'resolve','backend','frontend','browser'})
        self.assertEqual(required['outputs']['tested_sha'], '${{ steps.gate.outputs.tested_sha }}')
        browser = self.full['jobs']['browser']
        self.assertEqual(browser['strategy']['fail-fast'], 'false')
        group_step = next(step for step in browser['steps'] if step.get('name') == 'Chromium group and isolated evidence')
        self.assertNotIn('if', group_step)
        self.assertIn('npm run test:browser -- --group "$BROWSER_GROUP"', group_step['run'])
        self.assertIn('ci_gate.py evidence --group "$BROWSER_GROUP" --sha "$TESTED_SHA"', group_step['run'])
        self.assertEqual(self.full['on']['workflow_call']['outputs']['tested_sha']['value'],
                         '${{ jobs.required.outputs.tested_sha }}')

    def test_fast_does_not_publish_required_context_or_install_chromium(self):
        self.assertNotIn('required', self.fast['jobs'])
        text=json.dumps(self.fast)
        self.assertNotIn('playwright install', text)
        self.assertNotIn('CI required', text)

    def test_release_requires_full_ci_and_same_tested_commit(self):
        jobs=self.release['jobs']
        self.assertEqual(jobs['checks']['uses'], './.github/workflows/ci.yml')
        self.assertEqual(jobs['checks']['with']['ref'], '${{ needs.candidate.outputs.sha }}')
        self.assertEqual(set(jobs['windows']['needs']), {'candidate','checks'})
        self.assertEqual(jobs['windows']['steps'][0]['with']['ref'], '${{ needs.checks.outputs.tested_sha }}')
        self.assertEqual(self.release['on']['workflow_dispatch']['inputs']['publish']['default'], 'false')
        self.assertEqual(jobs['publish']['if'], "needs.candidate.outputs.publish == 'true'")

    def test_release_triggers_only_tags_and_manual_dispatch(self):
        self.assertEqual(set(self.release['on']), {'push', 'workflow_dispatch'})
        self.assertEqual(self.release['on']['push'], {'tags': ['v*']})

    def test_manual_dispatch_selects_candidate_without_publication(self):
        step = next(step for step in self.release['jobs']['candidate']['steps'] if step.get('id') == 'resolve')
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)/'outputs'
            env = dict(os.environ, EVENT='workflow_dispatch', REF='refs/heads/ci/restore-pipeline-optimization', REQUEST_PUBLISH='', RELEASE_TAG='', GITHUB_OUTPUT=str(output))
            subprocess.run(['bash', '-c', step['run']], cwd=ROOT, env=env, check=True, capture_output=True)
            values = dict(line.split('=',1) for line in output.read_text().splitlines())
            self.assertEqual(values['publish'], 'false')
            self.assertEqual(values['tag'], '')
            self.assertRegex(values['sha'], r'^[a-f0-9]{40}$')

    def test_actions_pinned_and_no_pull_request_target(self):
        for workflow in (self.full,self.fast,self.release):
            self.assertNotIn('pull_request_target', workflow['on'])
            for job in workflow['jobs'].values():
                for step in job.get('steps',[]):
                    if 'uses' in step:
                        self.assertRegex(step['uses'], r'@([a-f0-9]{40})$')


if __name__ == '__main__': unittest.main()
