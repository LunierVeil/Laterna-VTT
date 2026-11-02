import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('snapshot_manifest', ROOT / 'scripts/manifest-snapshot.py')
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


class StructureSafety(unittest.TestCase):
    def test_clean_preserves_campaign_and_configuration(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shutil.copy2(ROOT / 'Makefile', root / 'Makefile')
            private = ['server/lanterna.db', 'server/uploads/avatar.png', 'server/gm_key.txt', '.env']
            for name in private + ['web/dist/index.html']:
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text('sentinel ' + name)
            subprocess.run(['make', 'clean'], cwd=root, check=True, capture_output=True)
            for name in private:
                self.assertEqual((root/name).read_text(), 'sentinel ' + name)
            self.assertFalse((root/'web/dist').exists())

    def test_manifest_works_without_git_and_records_new_doc_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'source';root.mkdir();(root/'docs').mkdir()
            (root/'AGENTS.md').write_text('instructions')
            (root/'docs/ARCHITECTURE.md').write_text('decisions')
            report=manifest.generate(root,Path(temp)/'manifest.json')
            self.assertEqual([r['path'] for r in report['files']], ['AGENTS.md','docs/ARCHITECTURE.md'])
            self.assertFalse(report['has_git_directory'])

    def test_manifest_rejects_claude_and_git_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'source';root.mkdir()
            (root/'CLAUDE.md').write_text('local')
            with self.assertRaises(ValueError):manifest.generate(root,Path(temp)/'manifest.json')
            (root/'CLAUDE.md').unlink();(root/'.git').mkdir()
            with self.assertRaises(ValueError):manifest.generate(root,Path(temp)/'manifest.json')


if __name__=='__main__':unittest.main()
