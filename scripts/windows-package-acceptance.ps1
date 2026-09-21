param(
  [string]$DistDir = "desktop/dist",
  [int]$Port = 18788
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dist = (Resolve-Path (Join-Path $root $DistDir)).Path
$expectedVersion = (node -p "require('./package.json').version").Trim()
$head = (git rev-parse HEAD).Trim()
$started = [DateTime]::UtcNow
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } elseif ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
$installDir = Join-Path $tempRoot "ModbusEngineeringToolAcceptance"
$acceptancePath = Join-Path $dist "WINDOWS-ACCEPTANCE.json"
$environmentPath = Join-Path $dist "WINDOWS-ENVIRONMENT.txt"
$checks = New-Object System.Collections.Generic.List[object]

function Add-Check([string]$Name, [object]$Details = $null) {
  $row = [ordered]@{ name = $Name; ok = $true }
  if ($null -ne $Details) { $row.details = $Details }
  $checks.Add([pscustomobject]$row)
  Write-Host "PASS  $Name"
}

function Invoke-Json([string]$Url) {
  $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
  if ($response.StatusCode -ne 200) { throw "HTTP $($response.StatusCode): $Url" }
  return ($response.Content | ConvertFrom-Json)
}

function Wait-Health([string]$BaseUrl, [System.Diagnostics.Process]$Process) {
  for ($i = 0; $i -lt 80; $i++) {
    if ($Process.HasExited) { throw "Installed desktop exited before health became ready (code $($Process.ExitCode))." }
    try {
      return Invoke-Json "$BaseUrl/api/status"
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "Installed desktop did not expose /api/status at $BaseUrl."
}

function Stop-Tree([System.Diagnostics.Process]$Process) {
  if ($null -eq $Process -or $Process.HasExited) { return }
  try { & taskkill /PID $Process.Id /T /F | Out-Null } catch {}
}

$installer = Get-ChildItem $dist -Filter "Modbus-Engineering-Tool-Setup-*.exe" -File |
  Where-Object { $_.Name -notmatch '^Uninstall' } |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if (-not $installer) { throw "NSIS setup executable was not found in $dist." }

try { & taskkill /IM "Modbus Engineering Tool.exe" /T /F | Out-Null } catch {}
if (Test-Path $installDir) {
  for ($i = 0; $i -lt 8 -and (Test-Path $installDir); $i++) {
    try { Remove-Item $installDir -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds (250 * ($i + 1)) }
  }
  if (Test-Path $installDir) { throw "Acceptance install directory is still locked: $installDir" }
}
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

Write-Host "Installing $($installer.Name) to $installDir"
$install = Start-Process -FilePath $installer.FullName -ArgumentList @("/S", "/D=$installDir") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "NSIS silent install failed with exit code $($install.ExitCode)." }

$app = Get-ChildItem $installDir -Filter "Modbus Engineering Tool.exe" -File -Recurse | Select-Object -First 1
if (-not $app) {
  $app = Get-ChildItem $installDir -Filter "*.exe" -File -Recurse |
    Where-Object { $_.Name -notmatch '^Uninstall' } |
    Sort-Object FullName |
    Select-Object -First 1
}
if (-not $app) { throw "Installed application executable was not found." }
Add-Check "NSIS clean install" @{ installer = $installer.Name; installDir = $installDir; executable = $app.Name }

$env:MODBUS_DESKTOP_PORT = [string]$Port
$env:ELECTRON_DISABLE_SECURITY_WARNINGS = "true"
$proc = $null
try {
  $proc = Start-Process -FilePath $app.FullName -ArgumentList "--disable-gpu" -PassThru
  $base = "http://127.0.0.1:$Port"
  $status = Wait-Health $base $proc
  if ($status.productName -ne "Modbus Engineering Tool") { throw "Unexpected productName: $($status.productName)" }
  if ($status.productVersion -ne $expectedVersion) { throw "Unexpected productVersion: $($status.productVersion), expected $expectedVersion" }
  Add-Check "Installed health identity" @{ product = $status.productName; version = $status.productVersion }

  $rootResponse = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 3
  if ($rootResponse.StatusCode -ne 200 -or $rootResponse.Content -notmatch "Modbus Engineering Tool" -or $rootResponse.Content -notmatch "platform-v6.js") {
    throw "Installed unified UI root is invalid."
  }
  foreach ($asset in @("platform-v6.js","master-v7.js","slave-v7.js","network-discovery-v8.js","network-discovery-v8.css","help-v7.js")) {
    $assetResponse = Invoke-WebRequest -Uri "$base/$asset" -UseBasicParsing -TimeoutSec 3
    if ($assetResponse.StatusCode -ne 200 -or [string]::IsNullOrWhiteSpace($assetResponse.Content)) {
      throw "Installed asset failed: $asset"
    }
  }
  Add-Check "Installed unified UI assets"

  try {
    $legacy = Invoke-WebRequest -Uri "$base/v8/" -UseBasicParsing -TimeoutSec 2
    if ($legacy.StatusCode -eq 200) { throw "Compatibility v8 shell is exposed by installed desktop." }
  } catch {
    if ($_.Exception.Message -like "Compatibility v8 shell*") { throw }
  }
  Add-Check "Installed desktop blocks compatibility shell"

  $ports = Invoke-Json "$base/api/ports"
  if ($ports -isnot [System.Array]) { throw "/api/ports did not return an array." }
  Add-Check "Installed serial enumerator" @{ detectedPorts = $ports.Count }
} finally {
  Stop-Tree $proc
}

$environment = New-Object System.Collections.Generic.List[string]
$environment.Add("commit=$head")
$environment.Add("version=$expectedVersion")
$environment.Add("windows=$([System.Environment]::OSVersion.VersionString)")
$environment.Add("architecture=$env:PROCESSOR_ARCHITECTURE")
$environment.Add("runner=$env:RUNNER_NAME")
$environment.Add("generated_utc=$([DateTime]::UtcNow.ToString('o'))")
if (Get-Command Get-MpComputerStatus -ErrorAction SilentlyContinue) {
  try {
    $mp = Get-MpComputerStatus
    $environment.Add("defender_antivirus_enabled=$($mp.AntivirusEnabled)")
    $environment.Add("defender_realtime_enabled=$($mp.RealTimeProtectionEnabled)")
    $environment.Add("defender_behavior_monitor_enabled=$($mp.BehaviorMonitorEnabled)")
  } catch {
    $environment.Add("defender_status=unavailable:$($_.Exception.Message)")
  }
} else {
  $environment.Add("defender_status=cmdlet-unavailable")
}
if (Get-Command Get-NetFirewallProfile -ErrorAction SilentlyContinue) {
  try {
    foreach ($profile in Get-NetFirewallProfile) {
      $environment.Add("firewall_$($profile.Name.ToLower())_enabled=$($profile.Enabled)")
    }
  } catch {
    $environment.Add("firewall_status=unavailable:$($_.Exception.Message)")
  }
}
try {
  $pnp = Get-CimInstance Win32_PnPEntity |
    Where-Object { $_.Name -match 'COM\d+|USB|Serial' } |
    Select-Object -First 50 Name,PNPDeviceID,Status
  $environment.Add("serial_usb_devices_json=$($pnp | ConvertTo-Json -Compress)")
} catch {
  $environment.Add("serial_usb_inventory=unavailable:$($_.Exception.Message)")
}
$environment | Set-Content $environmentPath -Encoding utf8
Add-Check "Windows Defender firewall and serial inventory captured"

$uninstaller = Get-ChildItem $installDir -Filter "Uninstall*.exe" -File -Recurse | Select-Object -First 1
if (-not $uninstaller) { throw "NSIS uninstaller was not found." }
$uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw "NSIS silent uninstall failed with exit code $($uninstall.ExitCode)." }
for ($i = 0; $i -lt 40 -and (Test-Path $app.FullName); $i++) { Start-Sleep -Milliseconds 250 }
if (Test-Path $app.FullName) { throw "Installed application executable still exists after uninstall." }
Add-Check "NSIS clean uninstall"

$evidence = [ordered]@{
  schemaVersion = 1
  kind = "modbus-windows-package-acceptance"
  result = "PASS"
  commit = $head
  productVersion = $expectedVersion
  startedAt = $started.ToString("o")
  completedAt = [DateTime]::UtcNow.ToString("o")
  runner = $env:RUNNER_NAME
  windows = [System.Environment]::OSVersion.VersionString
  checks = $checks
}
$evidence | ConvertTo-Json -Depth 8 | Set-Content $acceptancePath -Encoding utf8
Write-Host ""
Write-Host "WINDOWS PACKAGE ACCEPTANCE: PASS"
Write-Host "Evidence: $acceptancePath"
