#!/usr/bin/env python3
"""Advisory Stop hook for tracked Laterna changes. Git output stays local."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
INPUT_LIMIT = 256 * 1024
CHECK_BUDGET = 1.5
ORIGINS = {
    "https://github.com/lunierveil/laterna-vtt",
    "git@github.com:lunierveil/laterna-vtt",
    "ssh://git@github.com/lunierveil/laterna-vtt",
}
PROJECT_DIRS = (
    "docs/", "scripts/", "server/app/", "server/tests/", "web/src/",
    "web/tests/", "windows/", ".agents/", ".codex/", ".github/",
)
ROOT_FILES = {
    ".env.example", ".gitattributes", ".gitignore", ".nvmrc", ".python-version",
    "LICENSE", "Makefile", "dev.sh", "laterna.sh", "docker-compose.yml",
    "server/Dockerfile", "server/requirements.txt", "server/smoke_test.py",
    "web/Dockerfile", "web/package.json", "web/package-lock.json",
    "web/index.html", "web/tsconfig.json", "web/vite.config.ts",
}
PRIVATE_NAMES = {"data", "uploads", "backups", "backup", "artifacts", "secrets", "gm_key.txt", "datahome"}
PROJECT_SUFFIXES = {".md", ".py", ".ts", ".tsx", ".js", ".mjs", ".css", ".html",
                    ".json", ".toml", ".yml", ".yaml", ".sh", ".bat", ".ps1", ".txt"}
DIAGNOSTIC = re.compile(
    rb"^(.+):([0-9]+): (trailing whitespace\.|space before tab in indent\.|leftover conflict marker\.)$",
    re.MULTILINE,
)


def git(cwd, deadline, *args):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired("git", CHECK_BUDGET)
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_ATTR_NOSYSTEM="1", GIT_OPTIONAL_LOCKS="0", GIT_NO_LAZY_FETCH="1",
               GIT_LITERAL_PATHSPECS="1", LC_ALL="C")
    return subprocess.run(
        ("git", "--no-optional-locks", "-c", "core.fsmonitor=false",
         "-c", f"core.attributesFile={os.devnull}", "-C", str(cwd), *args),
        env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, timeout=min(remaining, 0.6), check=False,
    )


def allowed_path(root, name):
    path = Path(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        return False
    if any(part.lower() in PRIVATE_NAMES or part.startswith(".laterna-") for part in path.parts):
        return False
    if name not in ROOT_FILES and not (
        path.suffix.lower() == ".md" and (len(path.parts) == 1 or name in {"server/AGENTS.md", "web/AGENTS.md"})
        or name.startswith(PROJECT_DIRS) and path.suffix.lower() in PROJECT_SUFFIXES
    ):
        return False
    # Skip symlinks at any depth, including links pointing inside the repository.
    current = root
    for part in path.parts:
        current /= part
        if current.is_symlink():
            return False
    return not current.exists() or current.is_file()


def check(payload, root=ROOT):
    if not isinstance(payload, dict):
        return "ERROR Stop: ожидается JSON-объект."
    if payload.get("hook_event_name") != "Stop" or payload.get("stop_hook_active") is True:
        return None
    cwd_text = payload.get("cwd")
    if not isinstance(cwd_text, str) or not Path(cwd_text).is_absolute():
        return "ERROR Stop: отсутствует допустимый cwd."
    try:
        cwd = Path(cwd_text).resolve(strict=True)
        if not cwd.is_dir() or not cwd.is_relative_to(root):
            return None
        deadline = time.monotonic() + CHECK_BUDGET
        top = git(cwd, deadline, "rev-parse", "--show-toplevel")
        if top.returncode:
            return "ERROR Stop: корень Git недоступен."
        if Path(os.fsdecode(top.stdout.rstrip(b"\r\n"))).resolve() != root:
            return None
        origin = git(root, deadline, "config", "--local", "--get", "remote.origin.url")
        if origin.returncode not in (0, 1):
            return "ERROR Stop: Git не прочитал origin."
        if os.fsdecode(origin.stdout).strip().lower().removesuffix(".git") not in ORIGINS:
            return None
        # Clean/process filters can launch arbitrary commands. Partial clones
        # can need network objects. Neither is required for this pilot.
        extensions = git(root, deadline, "config", "--includes", "--name-only", "--get-regexp",
                         r"^(filter\.|extensions\.partialclone$|remote\..*\.promisor$)")
        if extensions.returncode == 0:
            return "SKIP git diff --check: настроен Git-фильтр или partial clone."
        if extensions.returncode != 1:
            return "ERROR Stop: Git не прочитал настройки фильтров."
        messages = []
        markdown = False
        for mode in ((), ("--cached",)):
            options = ("diff", *mode, "--no-renames", "--no-ext-diff",
                       "--no-textconv", "--ignore-submodules=all")
            command = " ".join(("git", "diff", *mode, "--check"))
            names = git(root, deadline, *options, "--name-only", "-z", "--")
            if names.returncode:
                messages.append(f"ERROR {command}: список файлов недоступен.")
                continue
            paths = [os.fsdecode(name) for name in names.stdout.split(b"\0") if name]
            eligible = [name for name in paths if allowed_path(root, name)]
            markdown |= any(name.lower().endswith(".md") for name in eligible)
            if not eligible:
                continue
            if len(eligible) > 128 or sum(map(len, eligible)) > 24_000:
                messages.append(f"SKIP {command}: слишком много путей для локального hook.")
                continue
            result = git(root, deadline, *options, "--check", "--", *eligible)
            if result.returncode == 0:
                continue
            matches = DIAGNOSTIC.findall(result.stdout)
            if result.returncode != 2 or not matches:
                messages.append(f"ERROR {command}: Git не завершил проверку.")
                continue
            known = set(eligible)
            for filename, number, reason in matches[:2]:
                name = os.fsdecode(filename)
                if name not in known or not name.isprintable():
                    name = "путь скрыт"
                messages.append(f"WARN {command}: {name[:120]}:{number.decode()} — {reason.decode()}")
        if markdown:
            messages.append("SKIP Markdown links: вручную из корня python3 scripts/check-doc-links.py")
        return "\n".join(messages) or None
    except subprocess.TimeoutExpired:
        return "ERROR Stop: истёк тайм-аут Git. Вручную: git diff --check и git diff --cached --check."
    except FileNotFoundError:
        return "ERROR Stop: Git или cwd недоступен."
    except (OSError, RuntimeError, ValueError):
        return "ERROR Stop: путь или окружение недоступны."


def main():
    try:
        raw = sys.stdin.buffer.read(INPUT_LIMIT + 1)
        message = "ERROR Stop: слишком большой JSON." if len(raw) > INPUT_LIMIT else check(json.loads(raw))
    except (ValueError, RecursionError):
        message = "ERROR Stop: повреждённый или пустой JSON."
    if message:
        print(json.dumps({"systemMessage": message}, ensure_ascii=True))


if __name__ == "__main__":
    main()
