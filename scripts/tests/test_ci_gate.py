import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('ci_gate', Path(__file__).resolve().parents[1] / 'ci_gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = 'a' * 40


class RequiredGateTests(unittest.TestCase):
    def setUp(self):
        self.needs = {name: {'result': 'success', 'outputs': {}} for name in ('resolve', 'backend', 'frontend', 'browser')}
        self.needs['resolve']['outputs'] = {'sha': SHA, 'full': 'true'}
        for name in ('backend', 'frontend'):
            self.needs[name]['outputs'].update(tested_sha=SHA, run_id='123', attempt='2')
        self.records = [{'group': group, 'sha': SHA, 'run_id': '123', 'attempt': '2', 'passed': count} for group, count in gate.GROUP_COUNTS.items()]

    def check(self):
        return gate.validate(self.needs, self.records, '123', '2')

    def test_accepts_only_complete_current_run(self):
        self.assertEqual(self.check(), SHA)

    def test_rejects_failed_cancelled_or_skipped_jobs(self):
        for name in self.needs:
            for status in ('failure', 'cancelled', 'skipped', ''):
                with self.subTest(name=name, status=status):
                    self.needs[name]['result'] = status
                    with self.assertRaises(ValueError): self.check()
            self.needs[name]['result'] = 'success'

    def test_rejects_missing_duplicate_wrong_or_stale_evidence(self):
        original = copy.deepcopy(self.records)
        for key, value in [('sha', 'b'*40), ('run_id', '122'), ('attempt', '1'), ('passed', 0), ('group', 'unknown')]:
            self.records = copy.deepcopy(original)
            self.records[0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.check()
        for records in [original[:-1], original + [original[0]], original[:-1] + [original[0]]]:
            self.records = records
            with self.assertRaises(ValueError): self.check()

    def test_fast_draft_or_wrong_job_sha_cannot_satisfy_gate(self):
        self.needs['resolve']['outputs']['full'] = 'false'
        with self.assertRaises(ValueError): self.check()
        self.needs['resolve']['outputs']['full'] = 'true'
        self.needs['frontend']['outputs']['tested_sha'] = 'b'*40
        with self.assertRaises(ValueError): self.check()

    def test_reused_backend_or_frontend_attempt_cannot_satisfy_gate(self):
        for job in ('backend', 'frontend'):
            self.needs[job]['outputs']['attempt'] = '1'
            with self.assertRaises(ValueError): self.check()
            self.needs[job]['outputs']['attempt'] = '2'

    def test_candidate_must_equal_tested_sha(self):
        with self.assertRaises(ValueError): gate.validate(self.needs, self.records, '123', '2', 'master')
        self.assertEqual(gate.validate(self.needs, self.records, '123', '2', SHA), SHA)

    def test_junit_rejects_zero_missing_failed_skipped_or_disabled_tests(self):
        valid = '<testsuites><testsuite>' + '<testcase name="test"/>'*8 + '</testsuite></testsuites>'
        variants = [valid.replace('<testcase name="test"/>', '', 1), valid.replace('<testcase name="test"/>', '<testcase><skipped/></testcase>', 1), valid.replace('<testsuite>', '<testsuite disabled="1">'), valid.replace('<testcase name="test"/>', '<testcase><failure/></testcase>', 1), '<testsuites/>']
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'results.xml'
            path.write_text(valid)
            self.assertEqual(gate.browser_evidence('sheets', SHA, '123', '2', path)['passed'], 8)
            for invalid in variants:
                path.write_text(invalid)
                with self.subTest(invalid=invalid[:90]), self.assertRaises(ValueError): gate.browser_evidence('sheets', SHA, '123', '2', path)

    def test_pr_head_base_merge_draft_and_state_must_remain_current(self):
        old = {'head': {'sha': 'b'*40}, 'base': {'sha': 'c'*40}}
        live = dict(copy.deepcopy(old), merge_commit_sha=SHA, draft=False, state='open')
        event = {'number': 17, 'pull_request': old}
        gate.check_current('pull_request', event, SHA, '', lambda path: live)
        for key, value in [('head', {'sha':'d'*40}), ('base', {'sha':'d'*40}), ('merge_commit_sha','d'*40), ('draft',True), ('state','closed')]:
            changed = dict(live, **{key:value})
            with self.subTest(key=key), self.assertRaises(ValueError): gate.check_current('pull_request', event, SHA, '', lambda path: changed)

    def test_obsolete_push_fails_and_api_errors_propagate(self):
        event = {'ref':'refs/heads/master', 'after':SHA}
        with self.assertRaises(ValueError): gate.check_current('push', event, SHA, '', lambda path: {'object':{'sha':'b'*40}})
        def unavailable(path): raise OSError('API unavailable')
        with self.assertRaises(OSError): gate.check_current('push', event, SHA, '', unavailable)


if __name__ == '__main__': unittest.main()
