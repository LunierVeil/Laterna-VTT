"""Platform primitives for the local PB-08C installation and publication barriers."""

import ctypes
from ctypes import wintypes
from functools import cache
import os
from pathlib import Path
import sys
from contextlib import contextmanager


# This is a release decision, not a setting the launcher or environment can
# change. Candidate tests explicitly exercise the NTFS implementation before
# the physical/VM restart acceptance needed to change this policy.
WINDOWS_UPGRADE_ACCEPTED = False


@cache
def _win():  # Windows native APIs are loaded only when called on Windows.
    return ctypes.WinDLL("kernel32", use_last_error=True)


def _api(lib, name, result, *arguments):
    function = getattr(lib, name)
    function.restype = result
    function.argtypes = arguments
    return function


def windows_upgrade_allowed() -> bool:
    return WINDOWS_UPGRADE_ACCEPTED


class _Overlapped(ctypes.Structure):
    _fields_ = [("Internal", ctypes.c_size_t), ("InternalHigh", ctypes.c_size_t),
                ("Offset", wintypes.DWORD), ("OffsetHigh", wintypes.DWORD),
                ("hEvent", wintypes.HANDLE)]


def lock_installation(fd: int, *, shared: bool) -> None:
    if sys.platform != "win32":
        import fcntl

        fcntl.flock(fd, (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB)
        return

    import msvcrt

    lock = _api(_win(), "LockFileEx", wintypes.BOOL, wintypes.HANDLE, wintypes.DWORD,
                wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(_Overlapped))
    flags = 1 if shared else 3  # FAIL_IMMEDIATELY with optional EXCLUSIVE_LOCK.
    if not lock(msvcrt.get_osfhandle(fd), flags, 0, 1, 0, ctypes.byref(_Overlapped())):
        raise ctypes.WinError(ctypes.get_last_error())


@contextmanager
def _windows_handle(path: Path, access: int, flags: int):
    kernel = _win()
    create = _api(kernel, "CreateFileW", wintypes.HANDLE, wintypes.LPCWSTR, wintypes.DWORD,
                  wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    handle = create(str(path), access, 7, None, 3, flags, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield handle
    finally:
        _api(kernel, "CloseHandle", wintypes.BOOL, wintypes.HANDLE)(handle)


class _FileId(ctypes.Structure):
    _fields_ = [("volume", ctypes.c_uint64), ("identifier", ctypes.c_ubyte * 16)]


def windows_identity(path: Path) -> tuple[int, int]:
    # BACKUP_SEMANTICS accepts directories. OPEN_REPARSE_POINT ensures the
    # handle describes the opened name. Callers also validate all ancestors.
    with _windows_handle(path, 0x80, 0x02200000) as handle:
        identity = _FileId()
        info = _api(_win(), "GetFileInformationByHandleEx", wintypes.BOOL, wintypes.HANDLE,
                    ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
        if not info(handle, 18, ctypes.byref(identity), ctypes.sizeof(identity)):
            raise ctypes.WinError(ctypes.get_last_error())
        return identity.volume, int.from_bytes(bytes(identity.identifier), "little")


def windows_volume(path: Path) -> int:
    kernel = _win()
    root = ctypes.create_unicode_buffer(32768)
    volume_path = _api(kernel, "GetVolumePathNameW", wintypes.BOOL, wintypes.LPCWSTR,
                       wintypes.LPWSTR, wintypes.DWORD)
    if not volume_path(str(path), root, len(root)):
        raise ctypes.WinError(ctypes.get_last_error())
    drive_type = _api(kernel, "GetDriveTypeW", wintypes.UINT, wintypes.LPCWSTR)
    fs = ctypes.create_unicode_buffer(32)
    info = _api(kernel, "GetVolumeInformationW", wintypes.BOOL, wintypes.LPCWSTR,
                wintypes.LPWSTR, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p,
                ctypes.c_void_p, wintypes.LPWSTR, wintypes.DWORD)
    if (drive_type(root.value) != 3 or
            not info(root.value, None, 0, None, None, None, fs, len(fs)) or fs.value != "NTFS"):
        raise OSError("Для Windows upgrade необходим фиксированный локальный том NTFS.")
    return windows_identity(path)[0]


def windows_move(source: Path, destination: Path, *, replace: bool = False) -> None:
    move = _api(_win(), "MoveFileExW", wintypes.BOOL, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD)
    # Write-through, same volume. COPY_ALLOWED is deliberately absent.
    if not move(str(source), str(destination), 8 | int(replace)):
        raise ctypes.WinError(ctypes.get_last_error())


def windows_flush(path: Path) -> None:
    # A file commit alone never substitutes for the ordered barriers of the
    # complete transaction. Refuse any unsupported directory barrier.
    with _windows_handle(path, 0x40000000, 0x82200000) as handle:
        if not _api(_win(), "FlushFileBuffers", wintypes.BOOL, wintypes.HANDLE)(handle):
            raise ctypes.WinError(ctypes.get_last_error())


def _powershell_json(check: str, script: str, *arguments: str):
    import base64
    import json
    import re
    import subprocess

    # PowerShell 7 module paths inherited through Python can shadow the
    # Windows PowerShell 5.1 modules for ACL, CIM, and JSON.
    env = {key: value for key, value in os.environ.items() if key.upper() != "PSMODULEPATH"}
    # Values are transported as data, never interpolated into PowerShell code.
    for index, value in enumerate(arguments):
        env[f"LATERNA_PROBE_ARG_{index}"] = value
    command = (
        "$ErrorActionPreference='Stop'\n"
        "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)\n"
        "try {\n" + script + "\n} catch {\n"
        "    [Console]::Error.WriteLine($_.FullyQualifiedErrorId)\n"
        "    exit 1\n"
        "}\n"
    )
    encoded = base64.b64encode(command.encode("utf-16le")).decode("ascii")
    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
            env=env, capture_output=True, encoding="utf-8", errors="replace", timeout=25,
        )
    except subprocess.TimeoutExpired:
        raise OSError(f"Истекло время проверки Windows ({check}).") from None
    if proc.returncode != 0:
        # Keep paths, command lines and localized output out of the diagnostic.
        error_id = next((line for line in proc.stderr.splitlines()
                         if re.fullmatch(r"[a-zA-Z0-9.,_+-]{1,160}", line)), "PowerShellExit")
        raise OSError(f"Не удалось выполнить проверку Windows ({check}, {error_id}).")
    try:
        return json.loads(proc.stdout)
    except ValueError:
        raise OSError(f"Неверный ответ проверки Windows ({check}).") from None


def windows_directory_permissions(path: Path, *, private: bool) -> None:
    # Compare SIDs, not localized account names. Inherit-only ACEs cannot
    # authorize operations on a directory. Private state also protects files.
    result = _powershell_json("ACL", r"""
$acl = Get-Acl -LiteralPath $env:LATERNA_PROBE_ARG_0
$sidType = [System.Security.Principal.SecurityIdentifier]
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$user = $identity.User.Value
$administrators = 'S-1-5-32-544'
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
$owner = $acl.GetOwner($sidType).Value
$ownerIsTrusted = $owner -eq $user -or ($owner -eq $administrators -and $isAdministrator)
# S-1-3-4 (OWNER RIGHTS) grants access to the already-checked owner.
$allowed = @($user, 'S-1-5-18', $administrators, 'S-1-3-4')
$bad = @($acl.GetAccessRules($true, $true, $sidType) | Where-Object {
    $other = $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $allowed
    $inheritOnly = $_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly
    $canModify = ([long]$_.FileSystemRights -band 0x500D0156) -ne 0
    $other -and ($env:LATERNA_PROBE_ARG_1 -eq 'private' -or (-not $inheritOnly -and $canModify))
})
@{owner = $ownerIsTrusted; restricted = ($bad.Count -eq 0)} | ConvertTo-Json -Compress
""", str(path), "private" if private else "parent")
    if not isinstance(result, dict) or result.get("owner") is not True:
        raise OSError("Владелец каталога обновления Windows не подтверждён.")
    if result.get("restricted") is not True:
        raise OSError("ACL каталога Windows допускает доступ вне проверяемой локальной установки.")


def windows_require_legacy_stopped(legacy: Path) -> None:
    result = _powershell_json("Alpha processes", r"""
$root = [IO.Path]::GetFullPath($env:LATERNA_PROBE_ARG_0).TrimEnd('\') + '\'
$found = Get-CimInstance Win32_Process | Where-Object {
    $exe = $_.ExecutablePath
    $cmd = $_.CommandLine
    ($exe -and $exe.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) -or
    ($cmd -and ($cmd -match ([regex]::Escape($root) + 'laterna\.(bat|ps1)') -or
        ($cmd -match '(?i)app\.main' -and
        ($cmd.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
         $cmd -notmatch '(?i)--app-dir'))))

} | Select-Object -First 1
@{stopped = ($null -eq $found)} | ConvertTo-Json -Compress
""", str(legacy.parent))
    if result != {"stopped": True}:
        raise OSError("Остановите известные launcher и backend Alpha перед переносом.")
