param(
  [Parameter(Position = 0)][string]$Action,
  [Parameter(Position = 1)][string]$DeviceId,
  [Parameter(Position = 2)][string]$ObjectId,
  [Parameter(Position = 3)][string]$Value
)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$computer = $shell.Namespace(17)
if ($null -eq $computer) { throw 'Windows Portable Devices are unavailable.' }
$devices = @($computer.Items() | Where-Object { $_.Name -match '^Kindle(?:\s|$)' -and $_.IsFolder })

function FindDocuments($folder, [int]$depth) {
  if ($null -eq $folder -or $depth -gt 3) { return $null }
  foreach ($item in @($folder.Items())) {
    if (-not $item.IsFolder) { continue }
    if ($item.Name -ieq 'documents') { return $item.GetFolder }
    $found = FindDocuments $item.GetFolder ($depth + 1)
    if ($null -ne $found) { return $found }
  }
  return $null
}

if ($Action -eq 'devices') {
  $result = @()
  for ($i = 0; $i -lt $devices.Count; $i++) {
    $folder = $devices[$i].GetFolder
    if ($null -ne (FindDocuments $folder 0)) {
      $result += @{ id = [string]$i; name = [string]$devices[$i].Name }
    }
  }
  ConvertTo-Json -InputObject @($result) -Compress -Depth 4
  exit 0
}

$index = 0
if (-not [int]::TryParse($DeviceId, [ref]$index) -or $index -lt 0 -or $index -ge $devices.Count) { throw 'Kindle is disconnected.' }
$device = $devices[$index].GetFolder
$documents = FindDocuments $device 0
if ($null -eq $documents) { throw 'Kindle Documents folder is unavailable.' }

function DocumentFiles {
  @($documents.Items() | Where-Object { -not $_.IsFolder })
}

if ($Action -eq 'files') {
  $result = @(DocumentFiles | ForEach-Object {
    $size = $_.ExtendedProperty('System.Size')
    if ($null -ne $size) { @{ id = [string]$_.Name; name = [string]$_.Name; size = [long]$size } }
  })
  ConvertTo-Json -InputObject @($result) -Compress -Depth 4
  exit 0
}

if ($Action -eq 'get') {
  $item = @(DocumentFiles | Where-Object { $_.Name -ceq $ObjectId }) | Select-Object -First 1
  if ($null -eq $item) { throw 'Kindle file is unavailable.' }
  $destinationDir = Split-Path -Parent $Value
  $localFolder = $shell.Namespace($destinationDir)
  if ($null -eq $localFolder) { throw 'Temporary download folder is unavailable.' }
  $localFolder.CopyHere($item, 16)
  $copied = Join-Path $destinationDir $item.Name
  for ($i = 0; $i -lt 600; $i++) {
    if ((Test-Path -LiteralPath $copied) -and (Get-Item -LiteralPath $copied).Length -eq [long]$item.ExtendedProperty('System.Size')) { break }
    Start-Sleep -Milliseconds 200
  }
  if (-not (Test-Path -LiteralPath $copied) -or (Get-Item -LiteralPath $copied).Length -ne [long]$item.ExtendedProperty('System.Size')) { throw 'Kindle file download timed out.' }
  Move-Item -LiteralPath $copied -Destination $Value -ErrorAction Stop
  @{ ok = $true } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'put') {
  $source = $ObjectId
  $name = $Value
  if ($name -match '[\\/:*?"<>|]' -or $name -eq '' -or -not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Invalid Kindle file.' }
  if (@(DocumentFiles | Where-Object { $_.Name -ceq $name }).Count -gt 0) { throw 'Kindle already has a file with this name.' }
  if ((Split-Path -Leaf $source) -cne $name) { throw 'Kindle upload filename does not match.' }
  $documents.CopyHere($source, 16)
  $size = (Get-Item -LiteralPath $source).Length
  $uploaded = $null
  for ($i = 0; $i -lt 600; $i++) {
    $uploaded = @(DocumentFiles | Where-Object { $_.Name -ceq $name }) | Select-Object -First 1
    if ($null -ne $uploaded -and [long]$uploaded.ExtendedProperty('System.Size') -eq $size) { break }
    Start-Sleep -Milliseconds 200
  }
  if ($null -eq $uploaded -or [long]$uploaded.ExtendedProperty('System.Size') -ne $size) { throw 'Kindle file upload timed out.' }
  @{ id = $name } | ConvertTo-Json -Compress
  exit 0
}
throw 'Unsupported Kindle operation.'
