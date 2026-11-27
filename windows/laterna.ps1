param(
    [ValidateSet("Profile", "Portable", "NewPortable")][string]$Storage,
    [ValidateSet("Menu", "Lan", "GmLink", "Backup", "Paths", "Verify", "Restore", "UpgradeStatus")][string]$Action = "Menu",
    [string]$BackupPath,
    [string]$Destination,
    [string]$RestoredDataHome
)

# Laterna VTT для Windows: меню запуска (его открывает laterna.bat).
# Встроенный Python лежит рядом (python\python.exe) - ставить ничего не нужно.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root "python\python.exe"
$Server = Join-Path $Root "server"
$Port = if ($env:PORT) { $env:PORT } else { "8000" }

if ($Action -eq "UpgradeStatus") {
    Write-Host "HOLD: перенос Alpha в Profile или Portable закрыт до испытаний долговечной публикации на Windows."
    return
}

if (-not (Test-Path $Python)) {
    Write-Host "Нет python\python.exe рядом с laterna.bat."
    Write-Host "Запускай laterna.bat из распакованного архива релиза (Laterna-VTT-...-windows.zip)."
    exit 1
}

$BackupEntry = @'
import sys
sys.path.insert(0, sys.argv.pop(1))
from app.backup_cli import main
raise SystemExit(main())
'@
function Invoke-BackupCommand([string[]]$Arguments) {
    & $Python -X utf8 -c $BackupEntry $Server @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Операция резервного копирования не выполнена." }
}

if ($Action -eq "Verify") {
    if (-not $BackupPath) { throw "Укажите -BackupPath." }
    Invoke-BackupCommand @("verify", $BackupPath)
    return
}
if ($Action -eq "Restore") {
    if (-not $BackupPath -or -not $Destination) { throw "Укажите -BackupPath и -Destination." }
    Invoke-BackupCommand @("restore", $BackupPath, $Destination)
    return
}

# Resolve through the same Python contract used by the server. The embedded
# interpreter ignores PYTHONPATH, so pass the absolute app directory explicitly.
$Marker = Join-Path $Root "laterna-storage-mode.txt"
foreach ($Name in "DATABASE_URL", "UPLOAD_DIR", "GM_KEY_FILE", "LANTERNA_DATA_HOME", "LANTERNA_PORTABLE") {
    if ($null -ne [Environment]::GetEnvironmentVariable($Name, "Process")) {
        throw "Переменная $Name конфликтует с выбором хранилища Windows launcher."
    }
}
$Saved = if (Test-Path -LiteralPath $Marker) {
    $Item = Get-Item -LiteralPath $Marker -Force
    if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Некорректный файл выбора хранилища: $Marker"
    }
    [IO.File]::ReadAllText($Marker)
}
if ($null -ne $Saved -and $Saved -cnotin @("Profile", "Portable")) {
    throw "Повреждён файл выбора хранилища. Проверьте $Marker."
}
if ($Saved -and $Storage -and $Storage -ne $Saved) {
    throw "Выбор хранилища уже сохранён как $Saved. Сохраните данные и проверьте инструкцию PB05_DATAHOME."
}
if ($Storage -eq "NewPortable" -and $Action -notin @("Menu", "Lan")) {
    throw "Для создания portable запустите меню или режим LAN."
}
$Selected = if ($RestoredDataHome) {
    if ($Storage -or $Action -notin @("Lan", "Menu")) { throw "RestoredDataHome поддерживается при запуске меню или LAN без -Storage." }
    $env:LANTERNA_DATA_HOME = $RestoredDataHome
    $env:LANTERNA_REQUIRE_EXISTING = "1"
    "Restored"
} elseif ($Storage) { $Storage } elseif ($Saved) { $Saved } else {
    if ($Action -ne "Menu") { throw "Явно укажите -Storage Profile или -Storage Portable." }
    Write-Host "Первый запуск этого ZIP. Если у вас уже есть Alpha или portable, сохраните прежний каталог."
    Write-Host "1 — профиль Windows, 2 — открыть перенесённый portable, 3 — создать новый portable."
    switch (Read-Host "Выбор хранилища") {
        "1" { "Profile" }
        "2" { "Portable" }
        "3" { "NewPortable" }
        default { throw "Хранилище не выбрано." }
    }
}
if ($env:LANTERNA_GM_KEY -and $Selected -ne "Restored") {
    throw "Внешний LANTERNA_GM_KEY поддерживается для явно выбранного восстановленного стола."
}
$env:LANTERNA_PORTABLE = if ($Selected -in @("Profile", "Restored")) { "0" } else { "1" }
$Resolve = @'
import json, os, sys
from pathlib import Path
server = Path(sys.argv[1])
sys.path.insert(0, str(server))
from app.data_home import resolve_storage
paths = resolve_storage(os.environ, server_dir=server, cwd=Path.cwd())
if len(sys.argv) > 2 and sys.argv[2] == 'key':
    from app.storage_preflight import _entry
    path = Path(paths.gm_key)
    print(json.dumps(path.read_text(encoding='utf-8').strip() if _entry(path, directory=False) else None))
    raise SystemExit(0)
print(json.dumps({'home': str(paths.data_home), 'database': paths.database_url.database,
                  'uploads': str(paths.uploads), 'key': str(paths.gm_key)}))
'@
function Resolve-StoragePaths {
    $Result = & $Python -X utf8 -c $Resolve $Server
    if ($LASTEXITCODE -ne 0) { throw "Не удалось определить DataHome. Проверьте диагностику выше." }
    $Result | ConvertFrom-Json
}
$Paths = Resolve-StoragePaths
if ($Selected -eq "Profile") {
    $env:LANTERNA_PORTABLE = "1"
    try { $PortablePaths = Resolve-StoragePaths } finally { $env:LANTERNA_PORTABLE = "0" }
    if (Test-Path -LiteralPath $PortablePaths.home) {
        throw "Обнаружен portable DataHome: $($PortablePaths.home). Проверьте выбор хранилища."
    }
} elseif ($Selected -eq "NewPortable") {
    if (Test-Path -LiteralPath $Paths.home) { throw "Portable DataHome уже существует: $($Paths.home)" }
} elseif ($Selected -ne "Restored" -and -not (Test-Path -LiteralPath $Paths.database -PathType Leaf)) {
    throw "Portable SQLite отсутствует: $($Paths.database). Верните полный комплект данных."
}
if (-not $Saved -and $Selected -ne "Restored") {
    $Token = if ($Selected -eq "Profile") { "Profile" } else { "Portable" }
    $Stream = [IO.File]::Open($Marker, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $Bytes = [Text.Encoding]::ASCII.GetBytes($Token)
        $Stream.Write($Bytes, 0, $Bytes.Length)
    } finally { $Stream.Dispose() }
}
Write-Host "DataHome: $($Paths.home)"

function Test-PortBusy {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect("127.0.0.1", [int]$Port); return $true } catch { return $false } finally { $client.Close() }
}

function Start-Table([string]$HostAddr, [string]$Origins) {
    if (Test-PortBusy) {
        Write-Host "Порт $Port уже занят - похоже, стол уже запущен в другом окне. Закрой его и повтори."
        return
    }
    # X-Forwarded-For не учитываем никогда: через Porthole игроки приходят с
    # 127.0.0.1 и могли бы подделать заголовок (поэтому и --no-proxy-headers).
    $env:LANTERNA_TRUST_PROXY = "0"
    $env:LANTERNA_BACKUP_CONTROL = "1"
    $env:FRONTEND_URL = $Origins
    $env:WEB_DIST = Join-Path $Root "web\dist"
    Push-Location $Server
    try {
        & $Python -X utf8 -m uvicorn app.main:app --app-dir $Server --host $HostAddr --port $Port --no-proxy-headers
        if ($LASTEXITCODE -ne 0) { throw "Laterna не запустилась. Проверьте диагностику выше." }
    } finally {
        Pop-Location
    }
}

function Show-PortholeSteps {
    Write-Host ""
    Write-Host "  Стол для игры через Porthole: http://127.0.0.1:$Port (слушает только этот компьютер)"
    Write-Host ""
    Write-Host "  Мастеру:"
    Write-Host "    1. В Porthole (Steam) создай лобби и отдай в нём порт $Port (TCP)."
    Write-Host "    2. Передай игрокам код лобби."
    Write-Host "    3. Сам заходи на http://127.0.0.1:$Port. Первый раз - по ссылке мастера:"
    Write-Host "       её покажет пункт 3 меню после первого запуска."
    Write-Host "    4. Вкладка «Игроки» -> «Пригласить игрока» -> отправь ссылку. В ней замени"
    Write-Host "       127.0.0.1:$Port на адрес, который Porthole показал игроку."
    Write-Host ""
    Write-Host "  Игрокам:"
    Write-Host "    1. Поставь Porthole из Steam и введи код лобби."
    Write-Host "    2. Открой http://127.0.0.1:<порт>, который показал Porthole."
    Write-Host "    3. Первый раз - по ссылке-приглашению мастера, дальше - имя и пароль."
    Write-Host ""
    Write-Host "  Ctrl+C - остановить стол"
    Write-Host ""
}

function Show-LanSteps {
    Write-Host ""
    Write-Host "  Стол в локальной сети. Игрокам в этой сети:"
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
        ForEach-Object { Write-Host ("    http://{0}:{1}   ({2})" -f $_.IPAddress, $Port, $_.InterfaceAlias) }
    Write-Host "  Windows может спросить про брандмауэр - разреши для частной сети."
    Write-Host "  Ctrl+C - остановить стол"
    Write-Host ""
}

function Show-GmLink {
    $Result = & $Python -X utf8 -c $Resolve $Server key
    if ($LASTEXITCODE -ne 0) { throw "Файл ключа ГМ недоступен: $($Paths.key)" }
    $key = $Result | ConvertFrom-Json
    if (-not $key) {
        Write-Host "Ключ ГМ отсутствует или пуст: $($Paths.key)"
        return
    }
    $encodedKey = [Uri]::EscapeDataString($key)
    Write-Host "  Ссылка мастера: http://127.0.0.1:$Port/?gm=$encodedKey"
    Write-Host "  Не показывай её игрокам. Она нужна для первого входа и если забыл пароль."
    Write-Host ""
}

function Show-Backups {
    while ($true) {
        Write-Host "  1. Создать копию работающего стола"
        Write-Host "  2. Проверить копию"
        Write-Host "  3. Восстановить в новый DataHome"
        Write-Host "  4. Назад"
        try {
            switch (Read-Host "Резервные копии") {
                "1" { Invoke-BackupCommand @("create") }
                "2" { Invoke-BackupCommand @("verify", (Read-Host "Абсолютный путь к копии")) }
                "3" {
                    $Source = Read-Host "Абсолютный путь к копии"
                    $Target = Read-Host "Абсолютный путь к новому каталогу DataHome"
                    Write-Host "Источник: $Source"
                    Write-Host "Назначение: $Target"
                    Write-Host "Текущий стол сохраняется. Если каталог уже существует, операция остановится."
                    if ((Read-Host "Для запуска проверки и восстановления введите ДА") -ceq "ДА") {
                        Invoke-BackupCommand @("restore", $Source, $Target)
                        Write-Host "Для игры запустите laterna.bat -RestoredDataHome с указанным путём."
                    }
                }
                "4" { return }
            }
        } catch { Write-Host $_.Exception.Message }
    }
}

switch ($Action) {
    "Lan" { Start-Table "0.0.0.0" "http://localhost:$Port"; return }
    "GmLink" { Show-GmLink; return }
    "Backup" { Invoke-BackupCommand @("create"); return }
    "Paths" { $Paths | ConvertTo-Json -Compress; return }
}

while ($true) {
    Write-Host ""
    Write-Host "  Laterna VTT - альфа"
    Write-Host "    1. Игра через Porthole   (стол на 127.0.0.1:$Port)"
    Write-Host "    2. Игра в локальной сети"
    Write-Host "    3. Ссылка мастера (первый вход)"
    Write-Host "    4. Резервные копии"
    Write-Host "    5. Выход"
    $choice = Read-Host "  Выбери пункт"
    switch ($choice) {
        "1" { Show-PortholeSteps; Start-Table "127.0.0.1" "http://127.0.0.1:$Port,http://localhost:$Port" }
        "2" { Show-LanSteps; Start-Table "0.0.0.0" "http://localhost:$Port" }
        "3" { Show-GmLink }
        "4" { Show-Backups }
        "5" { exit 0 }
        default { Write-Host "Нет такого пункта." }
    }
}
