param([Parameter(Mandatory = $true)][string]$ZipPath)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 10)
$name = "pb08c-$suffix"
$root = Join-Path $env:PUBLIC "pb08c-qualification-$suffix"
$account = $null

try {
    $password = ConvertTo-SecureString ("Aa9!" + [Guid]::NewGuid().ToString("N")) -AsPlainText -Force
    $account = New-LocalUser -Name $name -Password $password
    Add-LocalGroupMember -SID "S-1-5-32-545" -Member $account -ErrorAction SilentlyContinue
    $credentials = [PSCredential]::new(".\$name", $password)
    $null = New-Item -ItemType Directory -Path $root
    $archive = Join-Path $root "historical.tar"
    git archive --format=tar -o $archive 4d2797d4589d42c11ac7e6fb6b13d338d011190f server/app windows/laterna.bat windows/laterna.ps1 laterna.sh
    if ($LASTEXITCODE -ne 0) { throw "Historical Alpha archive failed" }
    Copy-Item -LiteralPath $ZipPath -Destination (Join-Path $root "candidate.zip")
    Copy-Item -LiteralPath "$PSScriptRoot/pb08c-qualification.py" -Destination $root
    $scratch = Join-Path $root "scratch"
    $null = New-Item -ItemType Directory -Path $scratch
    $sid = $account.SID.Value
    icacls $root /grant "*${sid}:(OI)(CI)RX" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Cannot grant access to qualification inputs" }
    icacls $scratch /grant "*${sid}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Cannot grant access to qualification scratch" }

    $python = (Get-Command python.exe).Source
    $failed = @()
    foreach ($mode in "Profile", "Portable") {
        $stdout = Join-Path $root "$mode.stdout"
        $stderr = Join-Path $root "$mode.stderr"
        $arguments = "pb08c-qualification.py --require-standard-user --historical-archive historical.tar --zip candidate.zip --scratch `"$scratch`" --mode $mode"
        $process = Start-Process -FilePath $python -ArgumentList $arguments -Credential $credentials -LoadUserProfile `
            -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait -PassThru
        Get-Content -LiteralPath $stdout, $stderr
        if ($process.ExitCode -ne 0) { $failed += $mode }
    }
    if ($failed) { throw "Windows standard-user qualification failed for $($failed -join ', ')" }
} finally {
    if ($account) { Remove-LocalUser -SID $account.SID }
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
