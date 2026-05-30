$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $appDir ".runtime"
$targetDir = Join-Path $runtimeDir "node"

if (-not (Test-Path -LiteralPath $runtimeDir)) {
  New-Item -ItemType Directory -Path $runtimeDir | Out-Null
}

if ([Net.ServicePointManager]::SecurityProtocol -band [Net.SecurityProtocolType]::Tls12) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} else {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$fileKey = "win-$arch-zip"
$sources = @(
  "https://nodejs.org/dist",
  "https://npmmirror.com/mirrors/node"
)

$index = $null
$selectedSource = $null
foreach ($source in $sources) {
  try {
    Write-Host "[STEP] Fetching Node.js LTS release info from $source..."
    $index = Invoke-RestMethod "$source/index.json" -TimeoutSec 30
    $selectedSource = $source
    break
  } catch {
    Write-Host "[WARN] Failed to read $source/index.json"
    Write-Host ("       " + $_.Exception.Message)
  }
}

if (-not $index) {
  throw "Could not fetch Node.js release info from any source."
}

$release = $index | Where-Object {
  $_.lts -and ($_.files -contains $fileKey)
} | Select-Object -First 1

if (-not $release) {
  throw "No compatible Node.js LTS release was found for $arch."
}

$version = $release.version
$zipName = "node-$version-win-$arch.zip"
$url = "$selectedSource/$version/$zipName"
$zipPath = Join-Path $runtimeDir $zipName
$extractDir = Join-Path $runtimeDir "node-$version-win-$arch"

Write-Host "[STEP] Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zipPath

if (Test-Path -LiteralPath $targetDir) {
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}

if (Test-Path -LiteralPath $extractDir) {
  Remove-Item -LiteralPath $extractDir -Recurse -Force
}

Write-Host "[STEP] Extracting portable Node.js..."
Expand-Archive -LiteralPath $zipPath -DestinationPath $runtimeDir -Force
Rename-Item -LiteralPath $extractDir -NewName "node"
Remove-Item -LiteralPath $zipPath -Force

$nodeExe = Join-Path $targetDir "node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "node.exe was not found after extraction."
}

Write-Host "[OK] Portable Node.js installed:"
& $nodeExe -v
