$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $sourceRoot
$buildRoot = Join-Path $workspaceRoot "Build"
$installerRoot = Join-Path $workspaceRoot "installers"
$targetRoot = Join-Path $buildRoot "standalone-target"

New-Item -ItemType Directory -Path $buildRoot, $installerRoot, $targetRoot -Force | Out-Null
$env:CARGO_TARGET_DIR = $targetRoot

Push-Location $sourceRoot
try {
  & npm.cmd run tauri build
  if ($LASTEXITCODE -ne 0) { throw "Tauri build failed with exit code $LASTEXITCODE." }

  Copy-Item -LiteralPath (Join-Path $targetRoot "release\skill-studio.exe") -Destination (Join-Path $buildRoot "Skill Studio.exe") -Force
  Copy-Item -LiteralPath (Join-Path $targetRoot "release\bundle\nsis\Skill Studio_0.1.0_x64-setup.exe") -Destination (Join-Path $installerRoot "Skill Studio_0.1.0_x64-setup.exe") -Force
  Copy-Item -LiteralPath (Join-Path $targetRoot "release\bundle\msi\Skill Studio_0.1.0_x64_en-US.msi") -Destination (Join-Path $installerRoot "Skill Studio_0.1.0_x64_en-US.msi") -Force

  foreach ($resourceName in @("tools", "licenses")) {
    $buildResource = Join-Path $buildRoot $resourceName
    if (Test-Path -LiteralPath $buildResource) { Remove-Item -LiteralPath $buildResource -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $sourceRoot "src-tauri\resources\$resourceName") -Destination $buildResource -Recurse
  }
  Copy-Item -LiteralPath (Join-Path $sourceRoot "LICENSE") -Destination (Join-Path $buildRoot "licenses\SKILL-STUDIO-LICENSE.md") -Force

  $portableRoot = Join-Path $buildRoot "portable"
  if (Test-Path -LiteralPath $portableRoot) { Remove-Item -LiteralPath $portableRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $portableRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $targetRoot "release\skill-studio.exe") -Destination (Join-Path $portableRoot "Skill Studio.exe")
  Copy-Item -LiteralPath (Join-Path $buildRoot "tools") -Destination (Join-Path $portableRoot "tools") -Recurse
  Copy-Item -LiteralPath (Join-Path $buildRoot "licenses") -Destination (Join-Path $portableRoot "licenses") -Recurse
  $portableArchive = Join-Path $buildRoot "Skill-Studio-Portable-x64.zip"
  $temporaryArchive = Join-Path $buildRoot "Skill-Studio-Portable-x64.tmp.zip"
  if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive -Force }
  & tar.exe -a -c -f $temporaryArchive -C $portableRoot .
  if ($LASTEXITCODE -ne 0) { throw "Portable archive failed with exit code $LASTEXITCODE." }
  Move-Item -LiteralPath $temporaryArchive -Destination $portableArchive -Force
  Remove-Item -LiteralPath $portableRoot -Recurse -Force

  $frontendTarget = Join-Path $buildRoot "frontend-dist"
  if (Test-Path -LiteralPath $frontendTarget) { Remove-Item -LiteralPath $frontendTarget -Recurse -Force }
  Move-Item -LiteralPath (Join-Path $sourceRoot "dist") -Destination $frontendTarget

  $cacheRoot = Join-Path $buildRoot "cache"
  New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
  foreach ($buildInfo in @("tsconfig.app.tsbuildinfo", "tsconfig.node.tsbuildinfo")) {
    $buildInfoPath = Join-Path $sourceRoot $buildInfo
    if (Test-Path -LiteralPath $buildInfoPath) {
      Move-Item -LiteralPath $buildInfoPath -Destination (Join-Path $cacheRoot $buildInfo) -Force
    }
  }
} finally {
  Pop-Location
  Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
}
