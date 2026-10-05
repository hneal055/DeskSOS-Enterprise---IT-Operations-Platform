<#
.SYNOPSIS
    Creates the HTTPS certificate for DeskSOS Enterprise with mkcert.

.DESCRIPTION
    Issues backend/server/certs/server.crt and server.key from this PC's mkcert
    certificate authority (the same one DeskSOS Desktop uses), covering
    localhost, 127.0.0.1, the computer name and its LAN IPv4 addresses.

    It also writes certs/desksos-ca.crt: the CA's PUBLIC certificate. Import it
    on each LAN PC that opens the dashboard so browsers trust the site (see the
    README). The CA's private key (rootCA-key.pem in mkcert's folder) never
    leaves this PC: anyone holding it could issue certificates those PCs trust.

    Install mkcert first if needed:  winget install FiloSottile.mkcert

.EXAMPLE
    pwsh backend/server/scripts/gen-cert.ps1
    pwsh backend/server/scripts/gen-cert.ps1 -Names localhost,127.0.0.1,FORD-DC01,desksos.office.lan
#>
param(
    [string]$OutDir = (Join-Path $PSScriptRoot "..\certs"),
    # Default: localhost, 127.0.0.1, this computer's name and its LAN addresses
    [string[]]$Names
)

$ErrorActionPreference = 'Stop'

# mkcert may be installed by winget without being on PATH in this session
$mkcert = (Get-Command mkcert -ErrorAction SilentlyContinue).Source
if (-not $mkcert) {
    $mkcert = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter 'mkcert.exe' -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $mkcert) { throw "mkcert not found. Install it with: winget install FiloSottile.mkcert" }

if (-not $Names) {
    # Physical and Wi-Fi adapters only (skip Hyper-V / WSL / VPN virtual adapters)
    $lan = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' |
        ForEach-Object { Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue } |
        Where-Object { $_.IPAddress -notlike '169.254.*' } | ForEach-Object IPAddress
    $Names = @('localhost', '127.0.0.1', $env:COMPUTERNAME) + @($lan) | Select-Object -Unique
}

$OutDir = (New-Item -ItemType Directory -Force $OutDir).FullName

# Trust the local CA for this Windows user (idempotent; no admin needed)
& $mkcert -install
if ($LASTEXITCODE -ne 0) { throw "mkcert -install failed" }

& $mkcert -cert-file (Join-Path $OutDir 'server.crt') -key-file (Join-Path $OutDir 'server.key') @Names
if ($LASTEXITCODE -ne 0) { throw "mkcert failed to create the certificate" }

# Public CA certificate for other PCs (never the key)
$caRoot = (& $mkcert -CAROOT).Trim()
Copy-Item (Join-Path $caRoot 'rootCA.pem') (Join-Path $OutDir 'desksos-ca.crt') -Force

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (Join-Path $OutDir 'server.crt')
Write-Host ""
Write-Host "Certificate created in $OutDir" -ForegroundColor Green
Write-Host "  Covers:  $($Names -join ', ')"
Write-Host "  Expires: $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "  For other LAN PCs, import desksos-ca.crt into 'Trusted Root Certification Authorities' (see README)."
