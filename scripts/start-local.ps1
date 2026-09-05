$ErrorActionPreference = 'Stop'
$catalogDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $catalogDirectory
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$nodeMajor = [int]((& $nodeExecutable --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { throw 'Please install Node.js 24 or newer.' }
New-Item -ItemType Directory -Force -Path (Join-Path $catalogDirectory '.local') | Out-Null
$pidFile = Join-Path $catalogDirectory '.local\server.pid'
if (Test-Path -LiteralPath $pidFile) {
  $savedPid = [int](Get-Content -LiteralPath $pidFile)
  $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid"
  if ($existingProcess -and $existingProcess.CommandLine -and $existingProcess.CommandLine.Contains((Join-Path $catalogDirectory 'server\index.mjs'))) { Write-Host 'Catalogue is already running: http://127.0.0.1:3000'; exit 0 }
}
if (-not (Test-Path -LiteralPath (Join-Path $catalogDirectory 'node_modules'))) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed.' } }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed. Server was not started.' }
$serverScript = Join-Path $catalogDirectory 'server\index.mjs'
$serverProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('"' + $serverScript + '"') -WorkingDirectory $catalogDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $catalogDirectory '.local\server.log') -RedirectStandardError (Join-Path $catalogDirectory '.local\server-error.log')
$serverProcess.Id | Set-Content -LiteralPath $pidFile
Start-Sleep -Seconds 2
if ($serverProcess.HasExited) { throw 'Server could not start. Read .local/server-error.log.' }
Write-Host 'Catalogue: http://127.0.0.1:3000'
Write-Host 'Admin: http://127.0.0.1:3000/admin'
Write-Host 'Initial admin credentials: .local/admin-access.txt'
