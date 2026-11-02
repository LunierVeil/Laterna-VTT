param([Parameter(Mandatory=$true)][string]$ZipPath)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Temp = Join-Path ([IO.Path]::GetTempPath()) ("laterna-package-smoke-" + [guid]::NewGuid())
$Logs = Join-Path $Root 'artifacts/windows-smoke'
New-Item -ItemType Directory -Force $Temp, $Logs | Out-Null
$Names = @('DATABASE_URL','UPLOAD_DIR','GM_KEY_FILE','LANTERNA_GM_KEY','LANTERNA_TRUST_PROXY','WEB_DIST','FRONTEND_URL','PUBLIC_URL','PYTHONUTF8','SMOKE_BASE')
$Saved = @{}
foreach ($Name in $Names) { $Saved[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process') }
$Process = $null
try {
    Expand-Archive $ZipPath "$Temp/package"
    $App = Join-Path $Temp 'package'
    foreach ($Required in @('python/python.exe','server/app/main.py','web/dist/index.html','laterna.bat','laterna.ps1','LICENSE','SOURCE_COMMIT.txt')) {
        if (-not (Test-Path "$App/$Required")) { throw "Package missing $Required" }
    }
    foreach ($Private in @('server/lanterna.db','server/gm_key.txt','server/uploads','.env')) {
        if (Test-Path "$App/$Private") { throw "Private data in package: $Private" }
    }
    $PortProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $PortProbe.Start(); $Port = $PortProbe.LocalEndpoint.Port; $PortProbe.Stop()
    New-Item -ItemType Directory "$Temp/state" | Out-Null
    $Db = (Join-Path $Temp 'state/test.db').Replace('\','/')
    $env:DATABASE_URL = "sqlite+aiosqlite:///$Db"
    $env:UPLOAD_DIR = Join-Path $Temp 'state/uploads'
    $env:GM_KEY_FILE = Join-Path $Temp 'state/gm_key.txt'
    $env:LANTERNA_GM_KEY = [guid]::NewGuid().ToString('N')
    $env:LANTERNA_TRUST_PROXY = '0'
    $env:WEB_DIST = Join-Path $App 'web/dist'
    $env:SMOKE_BASE = "http://127.0.0.1:$Port"
    $env:FRONTEND_URL = $env:SMOKE_BASE
    $env:PUBLIC_URL = ''
    $env:PYTHONUTF8 = '1'
    $Server = Join-Path $App 'server'
    $Python = Join-Path $App 'python/python.exe'
    # Embedded ._pth isolates sys.path; WorkingDirectory alone cannot expose app.
    # Start-Process joins ArgumentList: preserve spaces in the app-dir argument.
    $QuotedServer = '"' + $Server + '"'
    $Process = Start-Process -FilePath $Python -PassThru -NoNewWindow -WorkingDirectory $Server `
        -ArgumentList @('-m','uvicorn','app.main:app','--app-dir',$QuotedServer,'--host','127.0.0.1','--port',"$Port",'--no-proxy-headers') `
        -RedirectStandardOutput "$Logs/server.stdout.log" -RedirectStandardError "$Logs/server.stderr.log"
    $Ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($Process.HasExited) { throw 'Packaged server exited before health-check' }
        try {
            $Health = Invoke-WebRequest "$env:SMOKE_BASE/api/health" -TimeoutSec 2
            if ($Health.StatusCode -eq 200) { $Ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $Ready) { throw 'Packaged server health-check timed out' }
    $Page = Invoke-WebRequest $env:SMOKE_BASE -TimeoutSec 10
    if ($Page.Content -notmatch 'Laterna') { throw 'Packaged frontend missing' }
    $Body = @{key=$env:LANTERNA_GM_KEY; name='Package smoke GM'; password=[guid]::NewGuid().ToString('N')} | ConvertTo-Json
    Invoke-RestMethod "$env:SMOKE_BASE/api/gm/login" -Method Post -ContentType 'application/json' -Body $Body | Out-Null
    & $Python "$PSScriptRoot/package-smoke.py"
    if ($LASTEXITCODE -ne 0) { throw 'Repository smoke-test against packaged application failed' }
    Write-Host 'PASS: extracted embedded Python, frontend and full repository smoke-test'
} finally {
    if ($Process -and -not $Process.HasExited) { Stop-Process -Id $Process.Id -Force; $Process.WaitForExit() }
    foreach ($Name in $Names) { [Environment]::SetEnvironmentVariable($Name, $Saved[$Name], 'Process') }
    if (Test-Path $Temp) { Remove-Item $Temp -Recurse -Force }
}
