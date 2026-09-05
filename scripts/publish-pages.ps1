$ErrorActionPreference = 'Stop'
$catalogDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $catalogDirectory

function Invoke-CatalogCommand {
  param([string]$Executable, [string[]]$CommandArguments)
  & $Executable @CommandArguments
  if ($LASTEXITCODE -ne 0) { throw "Command failed: $Executable $($CommandArguments -join ' ')" }
}

$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$nodeMajor = [int]((& $nodeExecutable --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { throw 'Please install Node.js 24 or newer.' }
Get-Command git -ErrorAction Stop | Out-Null
Get-Command npm.cmd -ErrorAction Stop | Out-Null

$repositoryRoot = & git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($repositoryRoot) -ne [IO.Path]::GetFullPath($catalogDirectory)) {
  throw 'Run this script from the catalogue repository.'
}
$currentBranch = & git branch --show-current
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne 'main') { throw 'Publishing requires the main branch. No files were changed.' }
$allowedRemotes = @(
  'https://github.com/qiao13822919184-byte/yumingxing_catalog',
  'git@github.com:qiao13822919184-byte/yumingxing_catalog',
  'ssh://git@github.com/qiao13822919184-byte/yumingxing_catalog'
)
foreach ($remoteArguments in @(@('remote', 'get-url', '--all', 'origin'), @('remote', 'get-url', '--push', '--all', 'origin'))) {
  $remoteUrls = @(& git @remoteArguments 2>$null)
  if ($LASTEXITCODE -ne 0 -or $remoteUrls.Count -ne 1) { throw 'Configure exactly one origin URL for this catalogue repository.' }
  $normalizedRemote = $remoteUrls[0].TrimEnd('/') -replace '\.git$', ''
  if ($normalizedRemote -cnotin $allowedRemotes) { throw 'Origin must point to qiao13822919184-byte/yumingxing_catalog on GitHub.' }
}
$initialChanges = @(& git status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Git working tree.' }
if ($initialChanges.Count -ne 0) {
  throw 'Commit or safely set aside existing source changes before publishing. This script only commits the public catalogue snapshot.'
}

if (-not (Test-Path -LiteralPath (Join-Path $catalogDirectory 'node_modules'))) {
  Invoke-CatalogCommand 'npm.cmd' @('ci')
}
Invoke-CatalogCommand 'npm.cmd' @('run', 'export:public')
Invoke-CatalogCommand 'npm.cmd' @('test')
Invoke-CatalogCommand 'npm.cmd' @('run', 'build:pages')
Invoke-CatalogCommand 'npm.cmd' @('run', 'test:pages')

$otherChanges = @(& git status --porcelain --untracked-files=all -- . ':(exclude)publication')
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect generated changes.' }
if ($otherChanges.Count -ne 0) {
  throw 'Files outside publication changed. Publishing stopped; review these files before retrying.'
}
Invoke-CatalogCommand 'git' @('add', '--', 'publication')
& git diff --cached --quiet
$snapshotDiff = $LASTEXITCODE
if ($snapshotDiff -gt 1) { throw 'Could not inspect the staged public snapshot.' }
if ($snapshotDiff -eq 1) {
  $publicationDate = Get-Date -Format 'yyyy-MM-dd HH:mm'
  Invoke-CatalogCommand 'git' @('commit', '-m', "Publish catalogue snapshot $publicationDate")
} else {
  Write-Host 'The public catalogue snapshot is unchanged.'
}
Invoke-CatalogCommand 'git' @('push', 'origin', 'HEAD:refs/heads/main')
Write-Host 'Snapshot pushed. GitHub Actions will deploy the catalogue after its checks pass.'
Write-Host 'Website: https://qiao13822919184-byte.github.io/yumingxing_catalog/'
Write-Host 'Deployment status: https://github.com/qiao13822919184-byte/yumingxing_catalog/actions/workflows/pages.yml'
