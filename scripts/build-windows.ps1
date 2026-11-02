param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9._-]+$')][string]$Name,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Out = Join-Path $Root "dist/$Name"
$ZipPath = "$Out.zip"
$EmbedVersion = '3.12.10'
if (Test-Path $Out) { throw "Output already exists: $Out" }
if (Test-Path $ZipPath) { throw "Archive already exists: $ZipPath" }
if (-not (Test-Path "$Root/web/dist/index.html")) { throw 'Build the frontend first' }
if ((git -C $Root rev-parse HEAD) -ne $SourceCommit) { throw 'Source commit mismatch' }
New-Item -ItemType Directory -Force $Out | Out-Null
$Download = Join-Path ([IO.Path]::GetTempPath()) ("laterna-python-" + [guid]::NewGuid() + '.zip')
try {
    Invoke-WebRequest "https://www.python.org/ftp/python/$EmbedVersion/python-$EmbedVersion-embed-amd64.zip" -OutFile $Download
    Expand-Archive $Download "$Out/python"
} finally {
    if (Test-Path $Download) { Remove-Item $Download }
}
$Pth = Get-ChildItem "$Out/python/python*._pth" | Select-Object -First 1
if (-not $Pth) { throw 'Embedded Python path configuration missing' }
$PythonZip = $Pth.BaseName + '.zip'
Set-Content $Pth.FullName "$PythonZip`r`n.`r`nLib\site-packages`r`nimport site" -Encoding ascii
# Wheels only: no dependence on a compiler or locally installed DLLs.
python -m pip install --only-binary=:all: --target "$Out/python/Lib/site-packages" -r "$Root/server/requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Installing Windows Python dependencies failed' }
New-Item -ItemType Directory -Force "$Out/server", "$Out/web", "$Out/docs" | Out-Null
Copy-Item "$Root/server/app" "$Out/server/app" -Recurse
Get-ChildItem "$Out/server/app" -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
Copy-Item "$Root/web/dist" "$Out/web/dist" -Recurse
Copy-Item "$Root/windows/laterna.bat", "$Root/windows/laterna.ps1" $Out
Copy-Item "$Root/docs/FIRST_SESSION.md" "$Out/docs/"
Copy-Item "$Root/LICENSE", "$Root/README.md" $Out
Set-Content "$Out/SOURCE_COMMIT.txt" $SourceCommit -Encoding ascii
Compress-Archive "$Out/*" $ZipPath
$Hash = (Get-FileHash $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content "$ZipPath.sha256" "$Hash  $Name.zip" -Encoding ascii
