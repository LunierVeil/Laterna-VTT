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

if (-not (Test-Path $Python)) {
    Write-Host "Нет python\python.exe рядом с laterna.bat."
    Write-Host "Запускай laterna.bat из распакованного архива релиза (Laterna-VTT-...-windows.zip)."
    exit 1
}

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
    $env:FRONTEND_URL = $Origins
    $env:WEB_DIST = Join-Path $Root "web\dist"
    Push-Location $Server
    try {
        & $Python -m uvicorn app.main:app --app-dir $Server --host $HostAddr --port $Port --no-proxy-headers
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
    Write-Host "       она появится ниже при первом запуске, потом - пункт 3 меню."
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
    $keyFile = Join-Path $Server "gm_key.txt"
    if (-not (Test-Path $keyFile)) {
        Write-Host "Ключа мастера ещё нет - он создаётся при первом запуске стола (пункт 1 или 2)."
        return
    }
    $key = (Get-Content $keyFile -Raw).Trim()
    Write-Host ""
    Write-Host "  Ссылка мастера: http://127.0.0.1:$Port/?gm=$key"
    Write-Host "  Не показывай её игрокам. Она нужна для первого входа и если забыл пароль."
    Write-Host ""
}

function Save-Backup {
    if (Test-PortBusy) {
        Write-Host "Сначала останови стол (Ctrl+C в его окне) - копию работающей базы делать нельзя."
        return
    }
    $dest = Join-Path $Root ("backup\" + (Get-Date -Format "yyyy-MM-dd_HH-mm"))
    New-Item -ItemType Directory -Force $dest | Out-Null
    foreach ($name in "lanterna.db", "uploads", "gm_key.txt") {
        $src = Join-Path $Server $name
        if (Test-Path $src) { Copy-Item $src -Destination $dest -Recurse -Force }
    }
    Write-Host "Копия сохранена: $dest"
    Write-Host "Вернуть - скопировать эти файлы обратно в папку server."
}

while ($true) {
    Write-Host ""
    Write-Host "  Laterna VTT - альфа"
    Write-Host "    1. Игра через Porthole   (стол на 127.0.0.1:$Port)"
    Write-Host "    2. Игра в локальной сети"
    Write-Host "    3. Ссылка мастера (первый вход)"
    Write-Host "    4. Копия базы в папку backup"
    Write-Host "    5. Выход"
    $choice = Read-Host "  Выбери пункт"
    switch ($choice) {
        "1" { Show-PortholeSteps; Start-Table "127.0.0.1" "http://127.0.0.1:$Port,http://localhost:$Port" }
        "2" { Show-LanSteps; Start-Table "0.0.0.0" "http://localhost:$Port" }
        "3" { Show-GmLink }
        "4" { Save-Backup }
        "5" { exit 0 }
        default { Write-Host "Нет такого пункта." }
    }
}
