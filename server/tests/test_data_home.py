from pathlib import PurePosixPath, PureWindowsPath

import pytest

from app.data_home import resolve_storage


def windows(env, install=r"D:\Laterna ZIP", cwd=r"C:\Other"):
    return resolve_storage(env, server_dir=PureWindowsPath(install) / "server", cwd=PureWindowsPath(cwd))


def linux(env, cwd="/checkout/server"):
    return resolve_storage(env, server_dir=PurePosixPath("/checkout/server"), cwd=PurePosixPath(cwd))


def test_windows_default_survives_zip_and_cwd_change():
    env = {"LOCALAPPDATA": r"C:\Users\GM\AppData\Local"}
    paths = windows(env)
    assert paths == windows(env, install=r"E:\New ZIP", cwd=r"C:\Somewhere")
    assert paths.mode == "default"
    assert paths.data_home == PureWindowsPath(env["LOCALAPPDATA"]) / "LaternaVTT"
    assert paths.database_url.database == (paths.data_home / "lanterna.db").as_posix()
    assert paths.uploads == paths.data_home / "uploads"
    assert paths.gm_key == paths.data_home / "gm_key.txt"


def test_windows_portable_requires_opt_in_and_anchors_at_zip():
    paths = windows({"LANTERNA_PORTABLE": "1"})
    assert paths.mode == "portable"
    assert paths.data_home == PureWindowsPath(r"D:\Laterna ZIP\data")
    assert paths == windows({"LANTERNA_PORTABLE": "1"}, cwd=r"C:\Elsewhere")
    assert windows({"LANTERNA_PORTABLE": "0", "LOCALAPPDATA": r"C:\Profile"}).mode == "default"


def test_explicit_home_is_absolute_and_does_not_touch_disk(tmp_path):
    target = tmp_path / "new data ? #"
    paths = resolve_storage({"LANTERNA_DATA_HOME": str(target)}, server_dir=tmp_path, cwd=tmp_path)
    assert paths.mode == "explicit"
    assert paths.database_url.database == (target / "lanterna.db").as_posix()
    assert paths.uploads == target / "uploads"
    assert paths.gm_key == target / "gm_key.txt"
    assert not target.exists()


def test_linux_development_paths_and_partial_overrides():
    paths = linux({}, cwd="/launch")
    assert paths.mode == "development"
    assert paths.data_home is None
    assert paths.database_url.database == "/launch/lanterna.db"
    assert paths.uploads == PurePosixPath("/checkout/server/uploads")
    assert paths.gm_key == PurePosixPath("/checkout/server/gm_key.txt")
    paths = linux({"DATABASE_URL": "postgresql+asyncpg://db/lanterna", "UPLOAD_DIR": "images"})
    assert paths.database_url.drivername == "postgresql+asyncpg"
    assert paths.uploads == PurePosixPath("/checkout/server/images")
    assert paths.gm_key == PurePosixPath("/checkout/server/gm_key.txt")


def test_existing_absolute_fixture_overrides_on_windows():
    paths = windows({
        "DATABASE_URL": "sqlite+aiosqlite:///C:/tmp/test.db",
        "UPLOAD_DIR": r"C:\tmp\uploads",
        "GM_KEY_FILE": r"C:\tmp\gm_key.txt",
    })
    assert paths.mode == "overrides"
    assert paths.data_home is None
    assert paths.database_url.database == "C:/tmp/test.db"
    assert paths.uploads == PureWindowsPath(r"C:\tmp\uploads")
    assert paths.gm_key == PureWindowsPath(r"C:\tmp\gm_key.txt")


@pytest.mark.parametrize(("env", "message"), [
    ({}, "LOCALAPPDATA is required"),
    ({"LOCALAPPDATA": ""}, "LOCALAPPDATA must be non-empty"),
    ({"LOCALAPPDATA": r"C:relative"}, "LOCALAPPDATA must be an absolute path"),
    ({"LOCALAPPDATA": r"\root-relative"}, "LOCALAPPDATA must be an absolute path"),
    ({"LANTERNA_DATA_HOME": "relative"}, "LANTERNA_DATA_HOME must be an absolute path"),
    ({"LANTERNA_DATA_HOME": r"D:\data", "LANTERNA_PORTABLE": "1"}, "mutually exclusive"),
    ({"LANTERNA_PORTABLE": "yes"}, "must be 0 or 1"),
    ({"LANTERNA_PORTABLE": "1", "UPLOAD_DIR": r"D:\uploads"}, "per-file overrides"),
    ({"DATABASE_URL": "sqlite+aiosqlite:///C:/tmp/db"}, "overrides require"),
    ({"DATABASE_URL": "sqlite+aiosqlite:///local.db", "UPLOAD_DIR": r"C:\uploads",
      "GM_KEY_FILE": r"C:\gm_key.txt"}, "SQLite DATABASE_URL must be an absolute path"),
])
def test_invalid_windows_configuration(env, message):
    with pytest.raises(ValueError, match=message):
        windows(env)


@pytest.mark.parametrize(("env", "message"), [
    ({"DATABASE_URL": "bad url"}, "DATABASE_URL is not a valid"),
    ({"DATABASE_URL": "sqlite+aiosqlite://"}, "must specify the SQLite database"),
    ({"UPLOAD_DIR": " "}, "UPLOAD_DIR must be non-empty"),
    ({"GM_KEY_FILE": "bad\0path"}, "GM_KEY_FILE must be non-empty"),
])
def test_invalid_development_overrides(env, message):
    with pytest.raises(ValueError, match=message):
        linux(env)
