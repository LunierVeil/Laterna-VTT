"""Explicit offline Linux Alpha upgrade preparation."""

import argparse
import os
from pathlib import Path
import sqlite3
import sys

from sqlalchemy.exc import SQLAlchemyError

from .alpha_upgrade import prepare_alpha_upgrade
from .data_home import resolve_storage
from .instance_backup import BackupError
from .storage_preflight import StorageError


def main() -> int:
    parser = argparse.ArgumentParser(description="Подготовить заблокированную копию подтверждённого Alpha DataHome.")
    parser.add_argument("--source", required=True, type=Path, help="Абсолютный путь остановленного DataHome")
    parser.add_argument("--destination", required=True, type=Path, help="Абсолютный путь нового DataHome")
    args = parser.parse_args()
    server = Path(__file__).resolve().parents[1]
    cwd = Path.cwd()
    try:
        paths = resolve_storage({"LANTERNA_DATA_HOME": str(args.source)}, server_dir=server, cwd=cwd)
        attempt = prepare_alpha_upgrade(paths, args.destination, server_dir=server, cwd=cwd, env=os.environ)
    except (BackupError, StorageError, ValueError, OSError, sqlite3.Error, SQLAlchemyError) as exc:
        print(f"Подготовка переноса остановлена: {exc}", file=sys.stderr)
        return 1
    print(f"Проверенная копия зафиксирована, попытка {attempt.attempt_id}. Для запуска требуется отдельный cutover.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
