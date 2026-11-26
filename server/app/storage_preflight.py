"""Read-only classification of storage before startup may create any state."""

from collections.abc import Mapping, Set
from contextlib import closing, contextmanager
import os
from pathlib import Path
import sqlite3
import stat
from typing import Literal

from .data_home import StoragePaths
from .schema_catalog import SchemaState, has_active_campaign_scene, inspect_schema


class StorageError(RuntimeError):
    """Startup cannot safely use the selected persistent storage."""


StorageState = Literal["first_run", "existing", "external"]
UPGRADE_STAGING_PREFIX = ".laterna-upgrade-staging-"
_SQLITE_SIDECARS = ("-journal", "-wal", "-shm")
_LEGACY_NAMES = ("lanterna.db", "uploads", "gm_key.txt",
                 *("lanterna.db" + suffix for suffix in _SQLITE_SIDECARS))


def _entry(path: Path, *, directory: bool) -> bool:
    """Check a pathname without accepting redirected or special files."""
    if ".." in path.parts:
        raise StorageError(f"Путь содержит '..': {path}")
    for part in (*reversed(path.parents), path):
        try:
            info = part.lstat()
        except FileNotFoundError:
            return False
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise StorageError(f"Путь хранилища перенаправлен: {part}")
        is_directory = directory or part != path
        if not (stat.S_ISDIR(info.st_mode) if is_directory else stat.S_ISREG(info.st_mode)):
            raise StorageError(f"Некорректный тип пути хранилища: {part}")
    return True


def _writable(path: Path, *, directory: bool = False) -> None:
    flags = os.R_OK | os.W_OK | (os.X_OK if directory else 0)
    if not os.access(path, flags):
        raise StorageError(f"Нет доступа на чтение и запись: {path}")


def _require_no_sqlite_sidecars(database: Path) -> None:
    for suffix in _SQLITE_SIDECARS:
        if _entry(database.with_name(database.name + suffix), directory=False):
            raise StorageError(f"У SQLite есть журнал или WAL: {database}. Остановите прежний экземпляр и сохраните данные.")


@contextmanager
def open_quiescent_sqlite(database: Path, *, require_rollback_journal: bool = False):
    """Inspect an existing SQLite file under the caller's storage locks."""
    def stamp(info):
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise StorageError(f"Некорректный файл SQLite: {database}")
        return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns

    if not _entry(database, directory=False):
        raise StorageError(f"SQLite отсутствует: {database}")
    original = stamp(database.lstat())
    _require_no_sqlite_sidecars(database)
    # Immutable read-only SQLite cannot replay a hot journal. Identity
    # checks detect replacement during inspection. Storage locks exclude
    # cooperating writers; this is not protection from another OS principal
    # acting with the owner's permissions.
    fd = os.open(database, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        if stamp(os.fstat(fd)) != original:
            raise StorageError(f"SQLite была заменена перед проверкой: {database}")
        _require_no_sqlite_sidecars(database)
        if require_rollback_journal:
            # Bytes 18 and 19 are the SQLite file write/read format versions.
            # A clean WAL file has no sidecars, and immutable SQLite can report
            # journal_mode=delete for it. Check the on-disk format before
            # allowing the offline gate to use the ordinary backup reader.
            header = os.read(fd, 20)
            if header[:16] != b"SQLite format 3\0" or header[18:20] != b"\x01\x01":
                raise StorageError("Offline upgrade требует SQLite в rollback journal format. WAL не допускается.")
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True)) as conn:
            yield conn
        _require_no_sqlite_sidecars(database)
        if stamp(database.lstat()) != original or stamp(os.fstat(fd)) != original:
            raise StorageError(f"SQLite изменилась во время проверки: {database}")
    finally:
        os.close(fd)


def _check_sqlite(database: Path, schema: Mapping[str, Set[str]], *, require_supported_catalog: bool) -> None:
    try:
        with open_quiescent_sqlite(database) as conn:
            if require_supported_catalog:
                state = inspect_schema(conn)
                if state is SchemaState.INVALID:
                    raise StorageError(f"SQLite не читается или повреждена либо содержит нарушенные связи: {database}")
                if state not in (SchemaState.ALPHA, SchemaState.CURRENT):
                    raise StorageError(f"Несовместимая схема SQLite ({state}): {database}. Сохраните исходную базу.")
            elif conn.execute("PRAGMA integrity_check(1)").fetchall() != [("ok",)]:
                raise StorageError(f"Проверка целостности SQLite не пройдена: {database}")
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            for name, expected in schema.items():
                columns = {row[0] for row in conn.execute(
                    "SELECT name FROM pragma_table_xinfo(?) WHERE hidden = 0", (name,),
                )}
                if name not in tables or columns != expected:
                    raise StorageError(
                        f"Несовместимая схема SQLite ({name}): {database}. "
                        "Сохраните исходную базу и используйте проверенную процедуру обновления."
                    )
            if not has_active_campaign_scene(conn):
                raise StorageError(f"SQLite не содержит кампании с активной сценой: {database}")
    except sqlite3.Error as exc:
        raise StorageError(f"SQLite не читается или повреждена: {database}") from exc


def check_storage(
    paths: StoragePaths, *, server_dir: Path, cwd: Path,
    env: Mapping[str, str], schema: Mapping[str, Set[str]],
    require_supported_catalog: bool = False,
) -> StorageState:
    """Classify existing state. Failure leaves every persistent file untouched."""
    try:
        return _check_storage(paths, server_dir=server_dir, cwd=cwd, env=env, schema=schema,
                              require_supported_catalog=require_supported_catalog)
    except (OSError, UnicodeError) as exc:
        raise StorageError(f"Не удалось прочитать или открыть хранилище Laterna: {exc}") from exc


def _check_storage(
    paths: StoragePaths, *, server_dir: Path, cwd: Path,
    env: Mapping[str, str], schema: Mapping[str, Set[str]],
    require_supported_catalog: bool,
) -> StorageState:
    home = Path(paths.data_home) if paths.data_home is not None else None
    uploads, key = Path(paths.uploads), Path(paths.gm_key)
    url = paths.database_url
    database = Path(url.database) if url.get_backend_name() == "sqlite" and url.database != ":memory:" else None
    if require_supported_catalog and database is not None and any(
        part.startswith(UPGRADE_STAGING_PREFIX) for part in database.parent.parts
    ):
        raise StorageError("Нельзя запускать промежуточный DataHome обновления.")
    files = (key,) if database is None else (key, database)
    if len(set(files)) != len(files) or any(uploads == file or uploads in file.parents for file in files):
        raise StorageError("Пути базы, uploads и ключа ГМ должны быть раздельными.")

    home_exists = home is not None and _entry(home, directory=True)
    for directory in {uploads.parent, *(file.parent for file in files)}:
        if not _entry(directory, directory=True):
            if home is None or directory != home or not _entry(home.parent, directory=True):
                raise StorageError(f"Родительский каталог хранилища отсутствует: {directory}")
            directory = home.parent
        _writable(directory, directory=True)

    uploads_exists = _entry(uploads, directory=True)
    key_exists = _entry(key, directory=False)
    env_key = env.get("LANTERNA_GM_KEY")
    if env_key and not env_key.strip():
        raise StorageError("LANTERNA_GM_KEY содержит только пробелы.")
    if key_exists and not key.read_text(encoding="utf-8").strip():
        raise StorageError(f"Файл ключа ГМ пуст: {key}")
    if uploads_exists:
        _writable(uploads, directory=True)

    if database is None:
        # External PostgreSQL (dev Compose) and explicit in-memory fixtures
        # retain their separate initialization contract.
        return "external"

    exists = _entry(database, directory=False)
    _require_no_sqlite_sidecars(database)

    if exists:
        if not uploads_exists or not (key_exists or env_key):
            raise StorageError(f"Неполное хранилище: для {database} отсутствует uploads или ключ ГМ.")
        _writable(database)
        _check_sqlite(database, schema, require_supported_catalog=require_supported_catalog)
        return "existing"

    # Explicitly isolated per-file fixtures may live alongside a checkout
    # which contains unrelated Alpha data. Partial overrides are not isolation.
    isolated = all(name in env for name in ("DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE"))
    if not isolated:
        previous_roots = {server_dir, cwd, server_dir.parent / "data"}
        if os.name == "nt" and env.get("LOCALAPPDATA") and Path(env["LOCALAPPDATA"]).is_absolute():
            previous_roots.add(Path(env["LOCALAPPDATA"]) / "LaternaVTT")
        for root in sorted(previous_roots - {home}):
            for name in _LEGACY_NAMES:
                candidate = root / name
                if candidate in (database, uploads, key):
                    continue
                if _entry(candidate, directory=name == "uploads"):
                    raise StorageError(
                        f"Найдены прежние данные: {candidate}. "
                        "Оставьте исходное хранилище на месте и используйте проверенную процедуру переноса."
                    )

    if uploads_exists or key_exists or (home_exists and any(home.iterdir())):
        raise StorageError(f"Неполное хранилище: отсутствует SQLite {database}.")
    return "first_run"


def prepare_storage(paths: StoragePaths, state: StorageState) -> None:
    """Create storage only after a successful preflight."""
    if state == "existing":
        return
    try:
        if state == "first_run":
            if paths.data_home is not None:
                Path(paths.data_home).mkdir(mode=0o700, exist_ok=True)
            # Never attach to a file created between preflight and initialization.
            fd = os.open(paths.database_url.database, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
        Path(paths.uploads).mkdir(mode=0o700, exist_ok=True)
    except OSError as exc:
        raise StorageError(f"Не удалось подготовить хранилище Laterna: {exc}") from exc
