"""Synthetic repositories only. No Codex credentials or network access."""

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "codex_hooks"))
import check_changes
sys.path.pop(0)

SCRIPT = Path(check_changes.__file__)
CONFIG = SCRIPT.parents[2] / ".codex/hooks.json"


class HookTests(unittest.TestCase):
    def setUp(self):
        temp = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(temp).resolve() / "repo"
        self.root.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "remote.origin.url", "https://github.com/LunierVeil/Laterna-VTT.git")
        self.git("config", "core.autocrlf", "false")
        self.write("server/app/test.py", "value = 1\n")
        self.write("web/src/test.ts", "export {}\n")
        self.write("docs/fixture.md", "# Fixture\n")
        self.write("docs/uploads/private.md", "# Synthetic private marker\n")
        self.script = self.root / "scripts/codex_hooks/check_changes.py"
        self.script.parent.mkdir(parents=True)
        shutil.copyfile(SCRIPT, self.script)
        config = self.root / ".codex/hooks.json"
        config.parent.mkdir()
        shutil.copyfile(CONFIG, config)
        hook = json.loads(config.read_bytes())["hooks"]["Stop"][0]["hooks"][0]
        self.command = hook["command"]
        self.git("add", ".")
        self.git("commit", "-qm", "Fixture")

    def git(self, *args):
        return subprocess.check_output(("git", "-C", str(self.root), *args))

    def write(self, path, value):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value, encoding="utf-8")
        return target

    def run_hook(self, payload=None, *, raw=None, cwd=None, launcher=False):
        if raw is None:
            raw = json.dumps(payload or self.payload()).encode()
        args = ("sh", "-c", self.command) if launcher else (
            sys.executable, "-I", "-B", str(self.script),
        )
        result = subprocess.run(args, input=raw, cwd=cwd or self.root,
                                capture_output=True, timeout=3, check=True)
        self.assertEqual(result.stderr, b"")
        if not result.stdout:
            return None
        self.assertLess(len(result.stdout), 1800)
        response = json.loads(result.stdout)
        self.assertEqual(set(response), {"systemMessage"})
        self.assertNotIn(str(self.root.parent), response["systemMessage"])
        return response["systemMessage"]

    def payload(self, **overrides):
        return {"hook_event_name": "Stop", "cwd": str(self.root), **overrides}

    def test_clean_stop_and_contract(self):
        self.assertIsNone(self.run_hook(launcher=True))

    def test_bad_empty_and_oversize_input(self):
        for raw in (b"", b"{", b"[]", b"\xff", b" " * (check_changes.INPUT_LIMIT + 1)):
            with self.subTest(raw=raw[:10]):
                self.assertIn("ERROR Stop", self.run_hook(raw=raw))

    def test_other_events_and_continuation(self):
        for event in ("PreToolUse", "PostToolUse", "SubagentStop", "Unknown"):
            with self.subTest(event=event):
                self.assertIsNone(self.run_hook(self.payload(hook_event_name=event)))
        self.assertIsNone(self.run_hook(self.payload(stop_hook_active=True)))

    def test_staged_and_unstaged_warnings_read_only_and_redacted(self):
        self.write("server/app/test.py", "SYNTHETIC_SECRET_STAGED = 2  \n")
        self.git("add", "server/app/test.py")
        self.write("web/src/test.ts", "// SYNTHETIC_SECRET_UNSTAGED  \n")
        before = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        message = self.run_hook(launcher=True)
        self.assertIn("WARN git diff --check: web/src/test.ts:1", message)
        self.assertIn("WARN git diff --cached --check: server/app/test.py:1", message)
        self.assertNotIn("SYNTHETIC_SECRET", message)
        self.assertNotIn("Markdown", message)
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()})

    def test_markdown_reports_manual_check_and_code_only_is_quiet(self):
        self.write("web/src/test.ts", "export const value = 1;\n")
        self.assertIsNone(self.run_hook())
        self.write("docs/fixture.md", "[missing](no-such-file.md)\n")
        self.assertIn("SKIP Markdown links", self.run_hook())
        (self.root / "docs/fixture.md").unlink()
        self.assertIn("SKIP Markdown links", self.run_hook())

    def test_nested_working_directories(self):
        self.write("web/src/test.ts", "export {}  \n")
        for sub in ("server", "web"):
            cwd = self.root / sub
            self.assertIn("WARN git diff", self.run_hook(self.payload(cwd=str(cwd)), cwd=cwd, launcher=True))

    def test_foreign_missing_and_symlink_cwd(self):
        self.assertIsNone(self.run_hook(self.payload(cwd=str(self.root.parent))))
        self.assertIn("ERROR Stop", self.run_hook(self.payload(cwd="relative")))
        self.assertIn("ERROR Stop", self.run_hook(self.payload(cwd=str(self.root / "missing"))))
        alias = self.root / "outside"
        alias.symlink_to(self.root.parent, target_is_directory=True)
        self.assertIsNone(self.run_hook(self.payload(cwd=str(alias))))
        self.git("config", "remote.origin.url", "https://example.invalid/foreign.git")
        self.assertIsNone(self.run_hook())

    def test_sensitive_and_symlinked_paths_are_skipped(self):
        self.write("docs/uploads/private.md", "SYNTHETIC_PRIVATE_DATA  \n")
        file = self.root / "docs/fixture.md"
        file.unlink()
        file.symlink_to(self.root.parent / "unavailable.md")
        self.assertIsNone(self.run_hook())

    def test_launcher_detects_changed_or_missing_code(self):
        self.script.write_text("raise SystemExit(99)\n")
        self.assertIn("ERROR Stop", self.run_hook(launcher=True))
        self.script.unlink()
        self.assertIn("ERROR Stop", self.run_hook(launcher=True))

    def test_external_git_filter_skips_without_running_it(self):
        self.git("config", "filter.danger.clean", "touch SIDE_EFFECT")
        self.write("web/src/test.ts", "export {}  \n")
        self.assertIn("SKIP git diff --check", self.run_hook())
        self.assertFalse((self.root / "SIDE_EFFECT").exists())

    def test_missing_git_and_timeout_are_advisory(self):
        for exc in (FileNotFoundError("secret path"), subprocess.TimeoutExpired("secret path", 0.1)):
            with self.subTest(error=type(exc)), patch.object(check_changes, "git", side_effect=exc):
                message = check_changes.check(self.payload(), root=self.root)
                self.assertIn("ERROR", message)
                self.assertNotIn("secret path", message)

    def test_git_subprocess_failure_reports_error(self):
        config = self.root / ".git/config"
        config.write_text("this is not git config\n")
        self.assertIn("ERROR Stop", self.run_hook())

    def test_real_short_subprocess_timeout(self):
        fixture = self.write("fake-bin/git", "#!/bin/sh\nexec sleep 0.8\n")
        fixture.chmod(0o700)
        with patch.dict(os.environ, PATH=os.pathsep.join((str(fixture.parent), os.defpath))):
            self.assertIn("истёк тайм-аут Git", self.run_hook())


if __name__ == "__main__":
    unittest.main()
