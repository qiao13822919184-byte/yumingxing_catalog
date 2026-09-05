$ErrorActionPreference = 'Stop'
$catalogDirectory = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $catalogDirectory '.local\server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No local server PID file.'; exit 0 }
$savedPid = [int](Get-Content -LiteralPath $pidFile)
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid"
if ($processInfo) {
 $expectedScript = Join-Path $catalogDirectory 'server\index.mjs'
 if (-not $processInfo.CommandLine.Contains($expectedScript)) { throw 'This PID does not belong to this catalogue. No process stopped.' }
 Stop-Process -Id $savedPid
}
Remove-Item -LiteralPath $pidFile -Force
Write-Host 'Local catalogue stopped. Your database and images remain saved.'
