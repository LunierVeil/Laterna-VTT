"""Resolve persistent paths without reading or changing installation state."""

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import PurePath, PurePosixPath, PureWindowsPath
from typing import Literal

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


@dataclass(frozen=True)
class StoragePaths:
    mode: Literal["default", "explicit", "portable", "development", "overrides"]
    data_home: PurePath | None
    database_url: URL
    uploads: PurePath
    gm_key: PurePath


def resolve_storage(
    env: Mapping[str, str], *, server_dir: PurePath, cwd: PurePath
) -> StoragePaths:
    """Select paths using the flavor of the supplied absolute server directory.

    The launcher supplies its own server directory, independent of cwd.
    Only development permits relative overrides, anchored at the supplied cwd.
    """
    windows = isinstance(server_dir, PureWindowsPath)
    path_type = PureWindowsPath if windows else PurePosixPath
    if not server_dir.is_absolute() or not cwd.is_absolute() or not isinstance(cwd, path_type):
        raise ValueError("DataHome requires absolute server and working directories of the same path flavor")

    def value(name: str) -> str | None:
        raw = env.get(name)
        if raw is not None and (not raw.strip() or "\0" in raw):
            raise ValueError(f"{name} must be non-empty and contain no NUL")
        return raw

    def absolute(name: str, raw: str) -> PurePath:
        path = path_type(raw)
        if not path.is_absolute():
            raise ValueError(f"{name} must be an absolute path")
        return path

    root = value("LANTERNA_DATA_HOME")
    portable = value("LANTERNA_PORTABLE")
    if portable not in (None, "0", "1"):
        raise ValueError("LANTERNA_PORTABLE must be 0 or 1")
    overrides = {name: value(name) for name in ("DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE")}
    has_overrides = any(raw is not None for raw in overrides.values())
    if root is not None and portable == "1":
        raise ValueError("LANTERNA_DATA_HOME and portable mode are mutually exclusive")
    if (root is not None or portable == "1") and has_overrides:
        raise ValueError("DataHome modes cannot be combined with per-file overrides")

    if root is not None:
        home = absolute("LANTERNA_DATA_HOME", root)
        mode = "explicit"
    elif portable == "1":
        home = server_dir.parent / "data"
        mode = "portable"
    elif windows and not has_overrides:
        local_app_data = value("LOCALAPPDATA")
        if local_app_data is None:
            raise ValueError("LOCALAPPDATA is required for the default Windows DataHome")
        home = absolute("LOCALAPPDATA", local_app_data) / "LaternaVTT"
        mode = "default"
    else:
        home = None
        mode = "overrides" if has_overrides else "development"

    if home is not None:
        return StoragePaths(
            mode, home, URL.create("sqlite+aiosqlite", database=(home / "lanterna.db").as_posix()),
            home / "uploads", home / "gm_key.txt",
        )

    if windows and any(raw is None for raw in overrides.values()):
        raise ValueError("Windows overrides require DATABASE_URL, UPLOAD_DIR and GM_KEY_FILE together")

    database = overrides["DATABASE_URL"]
    if database is None:
        url = URL.create("sqlite+aiosqlite", database=(cwd / "lanterna.db").as_posix())
    else:
        try:
            url = make_url(database)
        except (ArgumentError, ValueError):
            raise ValueError("DATABASE_URL is not a valid SQLAlchemy URL") from None
        if url.get_backend_name() == "sqlite":
            if not url.database:
                raise ValueError("DATABASE_URL must specify the SQLite database")
            if url.database != ":memory:":
                if "uri" in url.query or url.database.startswith("file:"):
                    raise ValueError("DATABASE_URL must use a SQLite filename, not a SQLite URI")
                path = absolute("SQLite DATABASE_URL", url.database) if windows else cwd / url.database
                url = url.set(database=path.as_posix())

    def override_path(name: str, default: str) -> PurePath:
        raw = overrides[name]
        if raw is None:
            return server_dir / default
        return absolute(name, raw) if windows else cwd / raw

    return StoragePaths(mode, None, url, override_path("UPLOAD_DIR", "uploads"),
                        override_path("GM_KEY_FILE", "gm_key.txt"))
