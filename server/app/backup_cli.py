"""Manual backup commands. Verify and restore never start a server."""

import argparse
import os
from pathlib import Path
import sys

from .backup_control import request_backup
from .data_home import resolve_storage
from .db import Base
from .instance_backup import BackupError, verify_backup
from .instance_restore import restore_backup
from .storage_preflight import StorageError


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="laterna backup")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("create", help="request a verified copy from the running local instance")
    commands.add_parser("verify", help="verify an existing backup").add_argument("backup", type=Path)
    restore = commands.add_parser("restore", help="restore to a new DataHome")
    restore.add_argument("backup", type=Path)
    restore.add_argument("destination", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "create":
            server = Path(__file__).resolve().parents[1]
            result = request_backup(resolve_storage(os.environ, server_dir=server, cwd=Path.cwd()))
            print(f"Backup: SUCCESS\nDataHome: {result['home']}\nFiles: {result['files']}\n"
                  f"Verification: PASSED\nLocation: {result['location']}")
        else:
            from . import models  # noqa: F401 — register the persistent schema

            schema = {table.name: set(table.columns.keys()) for table in Base.metadata.sorted_tables}
            if args.command == "verify":
                if not args.backup.is_absolute():
                    raise BackupError("Укажите абсолютный путь к копии.")
                manifest = verify_backup(args.backup, schema)
                print(f"Verification: PASSED\nFiles: {len(manifest['files'])}")
            else:
                manifest = restore_backup(args.backup, args.destination, schema,
                                          external_gm_key=os.getenv("LANTERNA_GM_KEY"))
                print(f"Restore: SUCCESS\nVerification: PASSED\nDataHome: {args.destination}")
            if manifest["key_mode"] == "external":
                print("Для запуска восстановленного стола нужен исходный LANTERNA_GM_KEY.")
    except (BackupError, StorageError, OSError, ValueError) as exc:
        print(f"Операция не выполнена: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
