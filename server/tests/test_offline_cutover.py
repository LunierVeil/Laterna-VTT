"""PB-08C tests use isolated installations and DataHome fixtures."""
import errno
import hashlib
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

from app import alpha_upgrade, offline_cutover as cutover, pre_upgrade
from app.instance_backup import BackupError
from app.storage_lock import own_storage
from .test_alpha_upgrade import alpha  # noqa: F401


def test_cutover_status_for_unregistered_installation(tmp_path):
    server = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-m", "app.migration_cli", "status", "--server-dir", str(tmp_path / "server")],
        cwd=server, capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "UNREGISTERED"
    assert not list(tmp_path.iterdir())

@pytest.fixture
def installation(alpha, tmp_path, monkeypatch):
    monkeypatch.delenv("LANTERNA_GM_KEY", raising=False)
    original = Path(alpha.data_home)
    legacy = tmp_path / "legacy" / "server"
    legacy.parent.mkdir()
    original.rename(legacy)
    (legacy / "app").mkdir()
    code = b"historical configuration fixture"
    (legacy / "app" / "config.py").write_bytes(code)
    launcher = b"historical launcher fixture"
    (legacy.parent / "laterna.sh").write_bytes(launcher)
    monkeypatch.setattr(cutover, "ALPHA_LAUNCHER", hashlib.sha256(launcher).hexdigest())
    monkeypatch.setattr(cutover, "ALPHA_CONFIG", hashlib.sha256(code).hexdigest())
    for module in (alpha_upgrade, cutover, pre_upgrade):
        monkeypatch.setattr(module, "_mount_id", lambda _: 1)
    monkeypatch.setattr(cutover, "_legacy_stopped", lambda _: None)
    server = tmp_path / "beta" / "server"
    server.mkdir(parents=True)
    return server, legacy, tmp_path / "destination"


def admitted(server, home):
    paths = cutover.paths_for(home, server)
    with own_storage(paths):
        return cutover.check_admission(paths, server)


def test_prepare_activate_and_never_fall_back(installation):
    server, legacy, target = installation
    original = (legacy / "lanterna.db").read_bytes()
    cutover.prepare(server, legacy, target)
    assert cutover.status(server) == "PENDING"
    root = cutover.state_path(server)
    assert not (legacy / "app").exists()
    assert (root / "alpha-app" / "config.py").exists()
    assert not (legacy.parent / "laterna.sh").exists()
    assert (root / "alpha-laterna.sh").exists()
    for home in (legacy, target):
        assert (home / pre_upgrade.FENCE).is_file()
        with pytest.raises(pre_upgrade.UpgradeBlocked):
            admitted(server, home)
    cutover.activate(server)
    cutover.activate(server)
    assert cutover.selected_home(server) == target
    assert admitted(server, target)
    assert (legacy / "lanterna.db").read_bytes() == original
    with pytest.raises(pre_upgrade.UpgradeBlocked):
        admitted(server, legacy)
    with pytest.raises(pre_upgrade.UpgradeBlocked):
        cutover.cancel(server)
    (target / "lanterna.db").rename(target / "unavailable")
    with pytest.raises(pre_upgrade.UpgradeBlocked):
        cutover.selected_home(server)
    with pytest.raises(pre_upgrade.UpgradeBlocked):
        admitted(server, legacy)
    assert not (target / "lanterna.db").exists()


def test_retry_keeps_previous_fences_and_takes_new_snapshot(installation):
    server, legacy, target = installation
    first = cutover.prepare(server, legacy, target)
    cutover.cancel(server)
    assert cutover.status(server) == "CANCELLED"
    retry = target.with_name("second-target")
    second = cutover.prepare(server, legacy, retry)
    assert first.attempt_id != second.attempt_id
    assert first.snapshot != second.snapshot
    assert (legacy / pre_upgrade.FENCE).exists()
    assert (target / pre_upgrade.FENCE).exists()
    cutover.activate(server)
    assert admitted(server, retry)
    with pytest.raises(pre_upgrade.UpgradeBlocked):
        admitted(server, target)


@pytest.mark.parametrize("error_number", [errno.EIO, errno.ENOSPC])
def test_visible_activation_must_pass_a_durable_barrier(installation, monkeypatch, error_number):
    server, legacy, target = installation
    cutover.prepare(server, legacy, target)
    root = cutover.state_path(server)
    sync = cutover._sync_directory

    def interrupted(directory, identity):
        if directory == root and (root / "activation.json").exists():
            raise OSError(error_number, "injected sync failure")
        return sync(directory, identity)

    monkeypatch.setattr(cutover, "_sync_directory", interrupted)
    with pytest.raises(OSError, match="injected sync failure"):
        cutover.activate(server)
    with pytest.raises(OSError, match="injected sync failure"):
        admitted(server, target)
    with pytest.raises(pre_upgrade.UpgradeBlocked):
        cutover.cancel(server)
    monkeypatch.setattr(cutover, "_sync_directory", sync)
    cutover.activate(server)
    assert admitted(server, target)


def test_storage_owner_prevents_activation(installation):
    server, legacy, target = installation
    cutover.prepare(server, legacy, target)
    with own_storage(cutover.paths_for(target, server)), pytest.raises(pre_upgrade.StorageError, match="занято"):
        cutover.activate(server)
    assert cutover.status(server) == "PENDING"


@pytest.mark.parametrize("journal_mode", ["DELETE", "WAL", "HOT"])
def test_recover_active_beta_after_interrupted_transaction(installation, journal_mode):
    server, legacy, target = installation
    cutover.prepare(server, legacy, target)
    cutover.activate(server)
    database = target / "lanterna.db"
    script = """
import os, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
hot = sys.argv[2] == 'HOT'
db.execute('PRAGMA journal_mode=' + ('DELETE' if hot else sys.argv[2]))
db.execute('PRAGMA cache_size=5')
db.execute('PRAGMA synchronous=FULL')
db.execute('PRAGMA wal_autocheckpoint=0')
db.execute("UPDATE campaigns SET name=?", ("confirmed Beta" + ("." * 65536 if hot else ""),))
db.commit()
db.execute('BEGIN IMMEDIATE')
db.execute("UPDATE campaigns SET name=?", ("uncommitted" * (65536 if hot else 1),))
os._exit(37)
"""
    child = subprocess.run([sys.executable, "-c", script, str(database), journal_mode], timeout=15)
    assert child.returncode == 37
    suffix = "-wal" if journal_mode == "WAL" else "-journal"
    sidecar = Path(str(database) + suffix)
    sidecar_bytes = sidecar.read_bytes()
    if journal_mode == "HOT":
        assert sidecar_bytes[:8] == bytes.fromhex("d9d505f920a163d7")
    expected = "confirmed Beta" + ("." * 65536 if journal_mode == "HOT" else "")
    backup = cutover.recover(server)
    root = cutover.state_path(server)
    archived = list(root.glob(f"sqlite-*/lanterna.db{suffix}"))
    assert len(archived) == 1 and archived[0].read_bytes() == sidecar_bytes
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT name FROM campaigns").fetchone() == (expected,)
    with sqlite3.connect(backup / database.name) as db:
        assert db.execute("SELECT name FROM campaigns").fetchone() == (expected,)
    assert admitted(server, target)
    assert (legacy / pre_upgrade.FENCE).is_file()



def test_lost_registration_cannot_create_an_empty_table(installation):
    server, legacy, target = installation
    cutover.prepare(server, legacy, target)
    cutover.activate(server)
    root = cutover.state_path(server)
    root.rename(root.with_name("disconnected-state"))
    other = target.with_name("wrong-datahome")
    with pytest.raises(pre_upgrade.UpgradeBlocked, match="Утрачена регистрация"):
        cutover.selected_home(server)
    with pytest.raises(pre_upgrade.UpgradeBlocked, match="Утрачена регистрация"):
        admitted(server, other)
    assert not other.exists()


def test_cancel_and_retry_after_failed_preparation(installation, monkeypatch):
    server, legacy, target = installation
    validate = alpha_upgrade._validate_equivalence

    def fail(*args):
        raise OSError(errno.EIO, "staging sync failure")

    monkeypatch.setattr(alpha_upgrade, "_validate_equivalence", fail)
    with pytest.raises(BackupError, match="staging sync failure"):
        cutover.prepare(server, legacy, target)
    assert (legacy / pre_upgrade.FENCE).exists()
    assert not target.exists()
    assert cutover.status(server) == "PENDING"
    with pytest.raises(pre_upgrade.UpgradeBlocked):
        cutover.selected_home(server)
    cutover.cancel(server)
    monkeypatch.setattr(alpha_upgrade, "_validate_equivalence", validate)
    second = target.with_name("fresh-target")
    cutover.prepare(server, legacy, second)
    cutover.activate(server)
    assert admitted(server, second)


def test_replayed_beta_remains_held_until_recovery_backup_is_verified(installation, monkeypatch):
    server, legacy, target = installation
    cutover.prepare(server, legacy, target)
    cutover.activate(server)
    database = target / "lanterna.db"
    db = sqlite3.connect(database)
    try:
        db.execute("UPDATE campaigns SET name='confirmed after activation'")
        db.commit()
    finally:
        db.close()
    backup = cutover.create_backup

    def fail(*args, **kwargs):
        raise OSError(errno.ENOSPC, "backup disk full")

    monkeypatch.setattr(cutover, "create_backup", fail)
    with pytest.raises(OSError, match="backup disk full"):
        cutover.recover(server)
    assert cutover.status(server) == "HOLD"
    with pytest.raises(pre_upgrade.UpgradeBlocked, match="восстановление"):
        admitted(server, target)
    monkeypatch.setattr(cutover, "create_backup", backup)
    result = cutover.recover(server)
    assert result.is_dir()
    assert admitted(server, target)
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT name FROM campaigns").fetchone() == ("confirmed after activation",)
