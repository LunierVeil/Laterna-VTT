import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('exporter', Path(__file__).parents[1] / 'export-github.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GithubExportSafety(unittest.TestCase):
    def test_api_collects_all_pages_with_read_only_gh(self):
        with patch.object(module.subprocess, 'check_output', return_value=b'[[{"id":1}],[{"id":2}]]') as call:
            self.assertEqual(module.api('owner/repo', 'releases', True), [{'id': 1}, {'id': 2}])
            self.assertEqual(call.call_args.args[0], ['gh', 'api', 'repos/owner/repo/releases', '--paginate', '--slurp'])

    def test_export_inside_git_working_tree_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.git').mkdir()
            with self.assertRaises(ValueError), patch.object(module.subprocess, 'check_output') as call:
                module.export('owner/repo', root / 'export')
            call.assert_not_called()
            self.assertFalse((root / 'export').exists())

    def test_permission_failure_never_creates_complete_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'export'
            with patch.object(module, 'ensure_private_output'), patch.object(module, 'api', side_effect=[{'name': 'repo'}, subprocess.CalledProcessError(1, ['gh', 'api'])]):
                with self.assertRaises(subprocess.CalledProcessError):
                    module.export('owner/repo', out)
            self.assertFalse((out / 'COMPLETE.json').exists())

    def test_release_assets_paginate_and_digest_mismatch_fails_closed(self):
        for corrupt in [False, True]:
            with self.subTest(corrupt=corrupt), tempfile.TemporaryDirectory() as directory:
                out = Path(directory) / 'export'
                payload = b'archive'
                assets = [{'id': i, 'size': len(payload), 'name': f'file-{i}.zip',
                           'digest': 'sha256:' + hashlib.sha256(payload).hexdigest()} for i in [11, 12]]
                def api(repo, endpoint, paginated=False):
                    if endpoint == '':
                        return {'name': 'repo'}
                    if endpoint == 'releases':
                        return [{'id': 1, 'assets': []}]  # Must use the dedicated paginated endpoint.
                    if endpoint == 'releases/1/assets':
                        self.assertTrue(paginated)
                        return assets
                    return []
                def collection(args):
                    key = 'workflows' if 'actions/workflows' in args[2] else 'environments'
                    return json.dumps([{key: [], 'total_count': 0}]).encode()
                def download(args, stdout, check):
                    self.assertTrue(check)
                    self.assertIn('Accept: application/octet-stream', args)
                    stdout.write(b'corrupt' if corrupt else payload)  # Same size; size-only validation is insufficient.
                # The managed test workspace itself has a parent .git. Simulate a private
                # non-Git export volume for these API/download tests; policy is tested above.
                with patch.object(module, 'ensure_private_output'), patch.object(module, 'api', side_effect=api), patch.object(module.subprocess, 'check_output', side_effect=collection), patch.object(module.subprocess, 'run', side_effect=download):
                    if corrupt:
                        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                            module.export('owner/repo', out)
                        self.assertFalse((out / 'COMPLETE.json').exists())
                    else:
                        module.export('owner/repo', out)
                        manifest = json.loads((out / 'COMPLETE.json').read_text())
                        self.assertIn('release-1/11', manifest['sha256'])
                        self.assertIn('release-1/12', manifest['sha256'])


if __name__ == '__main__':
    unittest.main()
