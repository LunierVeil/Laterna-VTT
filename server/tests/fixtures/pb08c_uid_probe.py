"""Manual Linux characterization. Run as mapped root in a rootless namespace."""

from contextlib import closing
from hashlib import sha256
import os
from pathlib import Path
import select
import shutil
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory
import traceback

from app.automatic_backup import BackupPolicy, BackupSeries
from app.backup_control import control_directory
from app.data_home import resolve_storage
from app.instance_backup import OnlineBackup, create_backup, verify_backup
from app.pre_upgrade import FENCE, _mount_id, assert_no_pending_upgrade
from app.storage_lock import own_storage
from app.storage_preflight import StorageError, check_storage
from app.upload_files import publish_upload
from tests.test_alpha_upgrade import alpha, files, prepare

PREPARER, RUNTIME, LEGACY = 1, 2, 3


def paths_for(home):
    return resolve_storage({"LANTERNA_DATA_HOME": str(home)}, server_dir=home.parent, cwd=home.parent)


def fork_as(uid, test):
    child = os.fork()
    if not child:
        try:
            os.setgroups([])
            os.setgid(uid)
            os.setuid(uid)
            assert os.geteuid() == uid
            test()
        except BaseException:
            traceback.print_exc()
            os._exit(1)
        os._exit(0)
    return child


def passed(child):
    _, status = os.waitpid(child, 0)
    assert os.waitstatus_to_exitcode(status) == 0


def acl(path, uid, permissions):
    subprocess.run(["setfacl", "-m", f"u:{uid}:{permissions}", path], check=True)


def deny(action, error=PermissionError, message=""):
    try:
        action()
    except error as exc:
        assert message in str(exc)
    else:
        raise AssertionError("operation unexpectedly succeeded")


def lock_paths(home):
    return [
        home.parent / (".laterna-" + sha256(os.fsencode(home / name)).hexdigest() + ".lock")
        for name in ("lanterna.db", "uploads", "gm_key.txt")
    ]


def prepare_probe(root):
    src_parent = root / "source-parent"
    dst_parent = root / "target-parent"
    for parent in (src_parent, dst_parent):
        parent.mkdir(mode=0o700)
        os.chown(parent, PREPARER, PREPARER)
    source = alpha.__wrapped__(src_parent)
    home = Path(source.data_home)
    for item in (home, *home.rglob("*")):
        item.chmod(0o700 if item.is_dir() else 0o600)
        os.chown(item, PREPARER, PREPARER)
    acl(home / "lanterna.db", RUNTIME, "rw")
    acl(home / "gm_key.txt", RUNTIME, "r")
    for item in (home / "uploads").iterdir():
        acl(item, RUNTIME, "r")
    before = files(home)
    prepared = dst_parent / "prepared"
    passed(fork_as(PREPARER, lambda: prepare(source, prepared)))
    for datahome in (home, prepared):
        assert (datahome / FENCE).is_file()
        deny(lambda: assert_no_pending_upgrade(paths_for(datahome)), StorageError)
    assert {name: data for name, data in files(home).items() if name != FENCE} == before
    for uid in (RUNTIME, LEGACY):
        for datahome in (home, prepared):
            passed(fork_as(uid, lambda: deny(lambda: (datahome / "lanterna.db").read_bytes())))
    passed(fork_as(LEGACY, lambda: deny(lambda: (src_parent / "lanterna.db").touch())))
    return home


def handoff_probe(root, original):
    parent = root / "neutral-parent"
    parent.mkdir(mode=0o700)
    home = parent / "neutral-home"
    shutil.copytree(original, home, ignore=shutil.ignore_patterns(FENCE))
    paths = paths_for(home)
    os.chown(parent, PREPARER, PREPARER)
    for item in (home, *home.rglob("*")):
        os.chown(item, PREPARER, PREPARER)
    passed(fork_as(PREPARER, lambda: take_lock(paths)))
    locks = lock_paths(home)
    inodes = [path.stat().st_ino for path in locks]
    for path in locks:
        os.chown(path, 0, 0)
        acl(path, PREPARER, "rw")
        acl(path, RUNTIME, "rw")
    os.chown(parent, 0, 0)
    acl(parent, RUNTIME, "x")
    acl(parent, PREPARER, "x")

    os.chown(home, RUNTIME, RUNTIME)
    os.chown(home / "uploads", RUNTIME, RUNTIME)
    acl(home / "lanterna.db", RUNTIME, "rw")
    acl(home / "gm_key.txt", RUNTIME, "r")
    for item in (home / "uploads").iterdir():
        acl(item, RUNTIME, "r")
    # Neutral Alpha-shaped fixture only. The prepared target stays fenced and inaccessible.
    acl(home, PREPARER, "x")
    for name in ("Laterna Backups", ".laterna-auto-" + sha256(os.fsencode(home)).hexdigest()):
        folder = parent / name
        folder.mkdir(mode=0o700)
        os.chown(folder, RUNTIME, RUNTIME)

    registry = root / "registry"
    registry.mkdir(mode=0o700)
    acl(registry, RUNTIME, "rx")
    anchor = root / "activation-anchor"
    anchor.mkdir(mode=0o700)
    acl(anchor, RUNTIME, "rx")
    records = [registry / "registration.json", registry / "decision.json", anchor / "activation.json"]
    for entry in records:
        entry.write_text("{}")
        entry.chmod(0o600)
        acl(entry, RUNTIME, "r")
    coordinator = registry / "coordinator.lock"
    coordinator.touch(mode=0o600)
    acl(coordinator, RUNTIME, "rw")

    def runtime():
        deny(lambda: (home / "gm_key.txt").write_bytes(b"attempt"))
        for entry in records:
            assert entry.read_bytes() == b"{}"
            deny(lambda: entry.write_bytes(b"foreign"))
            deny(entry.unlink)
        with coordinator.open("r+b"):
            deny(coordinator.unlink)
        for path in locks:
            deny(path.unlink)
            deny(lambda: path.chmod(0o600))
        deny(lambda: take_lock(paths_for(parent / "unprovisioned")), StorageError)
        with own_storage(paths):
            assert check_storage(paths, server_dir=parent, cwd=parent, env={}, schema={},
                                 require_supported_catalog=True) == "existing"
            assert control_directory(paths) == home / ".backup-control"
            series = BackupSeries(OnlineBackup(paths, {}, external_key=False), BackupPolicy())
            series._open()
            assert series.root.parent == parent
            assert (parent / "Laterna Backups").is_dir()
            with closing(sqlite3.connect(home / "lanterna.db")) as db:
                db.execute("UPDATE campaigns SET name = 'runtime fixture'")
                assert (home / "lanterna.db-journal").is_file()
                db.commit()
            upload = home / "uploads" / ("2" * 32 + ".png")
            publish_upload(upload.parent, upload.name, b"runtime fixture")
            assert upload.stat().st_mode & 0o777 == 0o600
            backup = parent / "Laterna Backups" / "neutral-backup"
            manifest = create_backup(paths, backup, {}, external_key=False)
            assert verify_backup(backup, {}) == manifest
        assert [path.stat().st_ino for path in locks] == inodes

    ready, signal = os.pipe()
    release, proceed = os.pipe()

    def hold():
        with own_storage(paths):
            os.write(signal, b"1")
            assert os.read(release, 1) == b"1"

    holder = fork_as(PREPARER, hold)
    try:
        assert select.select([ready], [], [], 10)[0] and os.read(ready, 1) == b"1"
        passed(fork_as(RUNTIME, lambda: deny(lambda: take_lock(paths), StorageError, "занято")))
    finally:
        os.write(proceed, b"1")
        for fd in (ready, signal, release, proceed):
            os.close(fd)
        passed(holder)
    passed(fork_as(RUNTIME, runtime))
    passed(fork_as(LEGACY, lambda: deny(lambda: (home / "lanterna.db").read_bytes())))


def take_lock(paths):
    with own_storage(paths):
        pass


def main():
    assert os.geteuid() == 0 and Path("/proc/self/uid_map").read_text().split()[1] != "0"
    with TemporaryDirectory(prefix="laterna-pb08c-uid-", dir=sys.argv[1]) as directory:
        root = Path(directory)
        assert _mount_id(root) > 0
        for uid in (PREPARER, RUNTIME):
            acl(root, uid, "x")
        home = prepare_probe(root)
        handoff_probe(root, home)
    print("PB-08B preparation and PB-05 ACL/lock contention passed under distinct mapped UIDs")


if __name__ == "__main__":
    main()
