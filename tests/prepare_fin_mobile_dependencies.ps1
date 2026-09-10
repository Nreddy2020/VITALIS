param([Parameter(Mandatory=$true)][string]$SourceProject)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$pilotRoot = Join-Path $workspaceRoot 'artifacts/mobile-pilot/fin-isolated'
$destination = Join-Path $pilotRoot 'node_modules'
if (-not (Test-Path -LiteralPath (Join-Path $pilotRoot 'pilot/install.js'))) {
    throw 'Prepare the isolated application first'
}
if (Test-Path -LiteralPath $destination) {
    throw 'Dependency destination must be absent to avoid following existing junctions'
}
$sourceDependencies = Join-Path (Resolve-Path -LiteralPath $SourceProject).Path 'node_modules'
& robocopy $sourceDependencies $destination /E /XJ /MT:16 /R:0 /W:0 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "Dependency copy failed: $LASTEXITCODE" }
exit 0
