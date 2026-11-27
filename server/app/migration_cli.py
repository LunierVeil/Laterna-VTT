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
from . import offline_cutover
from .storage_preflight import StorageError


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] in {"prepare", "activate", "status", "select", "cancel", "recover"}:
        return _cutover()
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



def _cutover() -> int:
    parser = argparse.ArgumentParser(description="Управление офлайн-обновлением Linux.")
    parser.add_argument("action", choices=("prepare", "activate", "status", "select", "cancel", "recover"))
    parser.add_argument("--server-dir", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--source", type=Path)
    parser.add_argument("--destination", type=Path)
    args = parser.parse_args()
    server = args.server_dir
    if not server.is_absolute() or server != server.resolve():
        parser.error("--server-dir должен быть каноническим абсолютным путём")
    if args.action == "prepare" and (args.source is None or args.destination is None):
        parser.error("prepare требует --source и --destination")
    if args.action != "prepare" and (args.source is not None or args.destination is not None):
        parser.error("--source и --destination разрешены только для prepare")
    try:
        if args.action == "prepare":
            offline_cutover.prepare(server, args.source, args.destination)
            print("Копия проверена и заблокирована до явной активации.")
        elif args.action == "status":
            print(offline_cutover.status(server))
        elif args.action == "select":
            path = offline_cutover.selected_home(server)
            if path is not None:
                print(path)
        elif args.action == "activate":
            offline_cutover.activate(server)
        elif args.action == "cancel":
            offline_cutover.cancel(server)
        else:
            print(f"Проверенная копия восстановления: {offline_cutover.recover(server)}")
    except (StorageError, BackupError, OSError, ValueError, sqlite3.Error, SQLAlchemyError) as exc:
        print(f"Обновление остановлено: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
