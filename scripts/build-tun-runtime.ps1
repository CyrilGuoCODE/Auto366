param(
  [Parameter(Mandatory = $true)]
  [string]$MihomoSource,

  [Parameter(Mandatory = $true)]
  [string]$WintunDll,

  [string]$OutputZip = (Join-Path $PSScriptRoot '..\artifacts\tun.zip'),
  [string]$Version = 'v1.19.27-auto366-system'
)

$ErrorActionPreference = 'Stop'

$sourcePath = (Resolve-Path -LiteralPath $MihomoSource).Path
$wintunPath = (Resolve-Path -LiteralPath $WintunDll).Path
$goCommand = Get-Command go -ErrorAction Stop
$outputPath = [IO.Path]::GetFullPath($OutputZip)
$stagingPath = Join-Path ([IO.Path]::GetTempPath()) ('auto366-tun-' + [guid]::NewGuid())
$executablePath = Join-Path $stagingPath 'mihomo-windows-amd64-compatible.exe'

New-Item -ItemType Directory -Path $stagingPath | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null

try {
  $buildTime = (& git -C $sourcePath show -s --format=%cI HEAD).Trim()
  if (-not $buildTime) { throw 'Unable to determine the Mihomo commit time.' }

  $savedCgo = $env:CGO_ENABLED
  $savedGoos = $env:GOOS
  $savedGoarch = $env:GOARCH
  $savedGoamd64 = $env:GOAMD64
  try {
    $env:CGO_ENABLED = '0'
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    $env:GOAMD64 = 'v1'
    $linkerFlags = "-X github.com/metacubex/mihomo/constant.Version=$Version " +
      "-X github.com/metacubex/mihomo/constant.BuildTime=$buildTime -w -s -buildid="

    Push-Location $sourcePath
    try {
      # Deliberately omit with_gvisor: Auto366 uses the Windows system TUN stack.
      & $goCommand.Source build -trimpath -ldflags $linkerFlags -o $executablePath .
      if ($LASTEXITCODE -ne 0) { throw "Mihomo build failed with exit code $LASTEXITCODE." }
    } finally {
      Pop-Location
    }
  } finally {
    $env:CGO_ENABLED = $savedCgo
    $env:GOOS = $savedGoos
    $env:GOARCH = $savedGoarch
    $env:GOAMD64 = $savedGoamd64
  }

  Copy-Item -LiteralPath $wintunPath -Destination (Join-Path $stagingPath 'wintun.dll')
  Compress-Archive -LiteralPath $executablePath,(Join-Path $stagingPath 'wintun.dll') `
    -DestinationPath $outputPath -CompressionLevel Optimal -Force

  [pscustomobject]@{
    Path = $outputPath
    Size = (Get-Item -LiteralPath $outputPath).Length
    Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath).Hash
  }
} finally {
  if (Test-Path -LiteralPath $stagingPath) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
  }
}
