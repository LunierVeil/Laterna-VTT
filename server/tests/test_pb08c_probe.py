"""Synthetic fixtures only. A classification never grants writable startup."""
from contextlib import closing
import hashlib
import json
import os
import sqlite3
import sys

import pytest

from .pb08c_probe import classify

pytestmark = pytest.mark.skipif(sys.platform != "linux", reason="Linux dirfd and SQLite cutover fixture")


def write(path, value):
    path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identity(path):
    info = path.stat()
    return [info.st_dev, info.st_ino]


@pytest.fixture
def operation(tmp_path):
    for name in ("registry", "source", "target", "source-anchor", "target-anchor"):
        (tmp_path / name).mkdir()
    for role in ("source", "target"):
        with closing(sqlite3.connect(tmp_path / role / "lanterna.db")) as database:
            database.execute("CREATE TABLE fixture (id INTEGER PRIMARY KEY)")
    registry = tmp_path / "registry"
    registration = registry / "registration.json"
    write(registration, {
        "version": 1, "installation": "test-install", "attempt": "test-attempt",
        "homes": {role: identity(tmp_path / role) for role in ("source", "target")},
        "databases": {role: identity(tmp_path / role / "lanterna.db") for role in ("source", "target")},
        "anchors": {role: identity(tmp_path / (role + "-anchor")) for role in ("source", "target")},
        "journal": identity(registry),
    })
    markers = {}
    for role in ("source", "target"):
        marker = tmp_path / role / ".laterna-upgrade-in-progress"
        write(marker, {"attempt": "test-attempt", "role": role})
        markers[role] = digest(marker)
    write(registry / "intent.json", {"registration": digest(registration), "markers": markers})
    return tmp_path


def decide(operation, role, activation=True):
    registry = operation / "registry"
    decision = registry / "decision.json"
    write(decision, {
        "intent": digest(registry / "intent.json"),
        "decision": "COMMIT_TARGET" if role == "target" else "ABORT_TO_SOURCE",
    })
    if activation:
        write(operation / (role + "-anchor") / "activation.json", {
            "decision": digest(decision), "role": role,
        })


def snapshot(root):
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_pending_has_no_selected_home(operation):
    before = snapshot(operation)
    assert classify(operation, "test-install") == "pending"
    assert classify(operation, "test-install", "target") == "hold"
    assert snapshot(operation) == before


@pytest.mark.parametrize("role", ["source", "target"])
def test_terminal_requires_matching_activation_and_never_selects_other_role(operation, role):
    decide(operation, role, activation=False)
    assert classify(operation, "test-install") == role + "-decision"
    assert classify(operation, "test-install", role) == "hold"
    decide(operation, role)
    before = snapshot(operation)
    assert classify(operation, "test-install", role) == role + "-confirmed"
    other = "source" if role == "target" else "target"
    assert classify(operation, "test-install", other) == "hold"
    assert classify(operation, "test-install", role) == role + "-confirmed"
    assert snapshot(operation) == before


@pytest.mark.parametrize("fault", [
    "bad-registration", "retarget-home", "foreign-anchor", "duplicate-key", "duplicate-activation",
    "no-decision", "bad-activation", "different-installation", "marker-mismatch",
    "no-home", "no-database", "replaced-database", "sidecar", "retired", "io",
])
def test_corruption_and_faults_hold(operation, fault, monkeypatch):
    decide(operation, "target")
    registry = operation / "registry"
    decision = registry / "decision.json"
    target = operation / "target"
    anchor = operation / "target-anchor"
    installation = "test-install"
    if fault == "bad-registration":
        (registry / "registration.json").write_text("{")
    elif fault == "retarget-home":
        target.rename(operation / "unrelated")
        target.mkdir()
    elif fault == "foreign-anchor":
        anchor.rename(operation / "foreign")
        anchor.symlink_to(operation / "foreign", target_is_directory=True)
    elif fault == "duplicate-key":
        decision.write_text('{"decision":"COMMIT_TARGET","decision":"ABORT_TO_SOURCE"}')
    elif fault == "duplicate-activation":
        write(operation / "source-anchor" / "activation.json", {"decision": digest(decision), "role": "source"})
    elif fault == "no-decision":
        decision.rename(registry / "missing")
    elif fault == "bad-activation":
        write(anchor / "activation.json", {"decision": "0" * 64, "role": "target"})
    elif fault == "different-installation":
        installation = "other-install"
    elif fault == "marker-mismatch":
        write(target / ".laterna-upgrade-in-progress", {"attempt": "other-attempt"})
    elif fault == "no-home":
        target.rename(operation / "absent")
    elif fault in ("no-database", "replaced-database"):
        (target / "lanterna.db").rename(target / "original.db")
        if fault == "replaced-database":
            (target / "lanterna.db").write_bytes((target / "original.db").read_bytes())
    elif fault == "sidecar":
        (target / "lanterna.db-journal").write_bytes(b"preserve")
    elif fault == "retired":
        write(registry / "retired.json", {"decision": digest(decision)})
    else:
        original = os.open

        def fail(name, *args, **kwargs):
            if name == "decision.json":
                raise OSError("injected disk read error")
            return original(name, *args, **kwargs)

        monkeypatch.setattr(os, "open", fail)
    before = snapshot(operation)
    assert classify(operation, installation) == "hold"
    assert classify(operation, installation, "source") == "hold"
    assert snapshot(operation) == before


def test_registered_probe_does_not_fall_back_to_environment(operation, monkeypatch):
    decide(operation, "target")
    (operation / "registry" / "registration.json").rename(operation / "registration.old")
    monkeypatch.setenv("LANTERNA_DATA_HOME", str(operation / "target"))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{operation / 'source' / 'lanterna.db'}")
    before = snapshot(operation)
    assert classify(operation, "test-install") == "hold"
    assert classify(operation, "test-install", "target") == "hold"
    assert snapshot(operation) == before
