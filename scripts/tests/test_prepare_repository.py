import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).parents[1] / 'prepare-repository.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.dest = self.root / 'new'

    def run_copy(self, names):
        def git(args, **kwargs):
            if 'ls-files' in args:
                return b'\0'.join(n.encode() for n in names) + b'\0'
            if '--show-toplevel' in args:
                return str(self.source)
            if 'rev-parse' in args:
                return 'a' * 40
            if 'status' in args:
                return ' M README.md\n'
            self.fail(f'Unexpected Git operation: {args}')
        with patch.object(module.subprocess, 'check_output', side_effect=git):
            module.prepare(self.source, self.dest)

    def test_working_edits_and_new_files_included_without_git_or_private_files(self):
        (self.source / 'README.md').write_text('unsaved working edit')
        (self.source / 'new.py').write_text('print(1)')
        (self.source / '.git').mkdir()
        (self.source / 'gm_key.txt').write_text('private - not returned by git ls-files')
        (self.source / 'CLAUDE.md').write_text('local instructions')
        self.run_copy(['README.md', 'new.py', 'deleted.py', 'CLAUDE.md'])
        self.assertFalse((self.dest / 'CLAUDE.md').exists())
        self.assertEqual((self.source / 'CLAUDE.md').read_text(), 'local instructions')
        self.assertEqual((self.dest / 'README.md').read_text(), 'unsaved working edit')
        self.assertFalse((self.dest / '.git').exists())
        self.assertFalse((self.dest / 'gm_key.txt').exists())
        self.assertFalse((self.dest / 'deleted.py').exists())
        self.assertEqual(len(json.loads(self.dest.with_suffix('.manifest.json').read_text())['files']), 2)

    def test_tracked_database_aborts_before_copy(self):
        (self.source / 'campaign.db').write_text('private data')
        with self.assertRaises(ValueError):
            self.run_copy(['campaign.db'])
        self.assertFalse(self.dest.exists())
        self.assertEqual((self.source / 'campaign.db').read_text(), 'private data')

    def test_known_credential_aborts_without_printing_value(self):
        (self.source / 'token.txt').write_text('ghp_' + 'A' * 36)
        with self.assertRaisesRegex(ValueError, 'Possible credential') as error:
            self.run_copy(['token.txt'])
        self.assertNotIn('A' * 36, str(error.exception))
        self.assertFalse(self.dest.exists())

    def test_symlink_not_followed(self):
        (self.root / 'private').write_text('private')
        (self.source / 'link').symlink_to(self.root / 'private')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.run_copy(['link'])

    def test_existing_destination_is_not_overwritten(self):
        self.dest.mkdir()
        (self.dest / 'keep').write_text('keep')
        with self.assertRaises(ValueError):
            self.run_copy([])
        self.assertEqual((self.dest / 'keep').read_text(), 'keep')

    def test_destination_inside_active_repository_rejected(self):
        self.dest = self.source / 'new'
        with self.assertRaises(ValueError):
            self.run_copy([])

    def test_local_env_and_private_directories_rejected_but_example_allowed(self):
        for name in ['CLAUDE.md', '.env', '.env.local', '.ENV.local', 'campaign.DB', 'server/UPLOADS/avatar.svg', 'server/uploads/avatar.svg', 'backup/game.json', '.git/config']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                module.audit(name, b'example')
        module.audit('.env.example', b'PUBLIC_URL=https://table.example')


if __name__ == '__main__':
    unittest.main()
