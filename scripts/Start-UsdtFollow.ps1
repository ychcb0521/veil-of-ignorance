param(
    [Parameter(Mandatory=$true)][string]$CredentialDirectory,
    [string]$Owner,
    [string]$Proxy,
    [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$directory = (Resolve-Path -LiteralPath $CredentialDirectory).Path
if ($Proxy) {
    $env:HTTPS_PROXY = $Proxy
    $env:NODE_USE_ENV_PROXY = '1'
    $env:NO_PROXY = '127.0.0.1,localhost'
}
if (![string]::IsNullOrWhiteSpace($Owner) -and $Owner -notmatch '\A[0-9a-fA-F-]{36}\z') {
    throw '请提供无知之幕账号 ID。'
}
Push-Location -LiteralPath $repo
try {
    $entry = Join-Path $PSScriptRoot 'usdt-follow-server.ts'
    if ($VerifyOnly) {
        & node $entry $directory
        exit $LASTEXITCODE
    }
    $configPath = Join-Path $directory 'usdt-follow.json'
    if (!(Test-Path -LiteralPath $configPath)) {
        if (!$Owner) { $Owner = Read-Host '请输入无知之幕账号 ID' }
        if ($Owner -notmatch '\A[0-9a-fA-F-]{36}\z') { throw '无知之幕账号 ID 无效。' }
        $verification = & node $entry $directory --prepare
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        $identity = ($verification | ConvertFrom-Json).account
        if ($identity -notmatch '\A[0-9a-f]{64}\z') { throw '币安账号身份未验证。' }
        $config = [ordered]@{
            owner = $Owner
            token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
            account = $identity
        }
        $config | ConvertTo-Json -Compress | Set-Content -Encoding utf8 -LiteralPath $configPath
    } else {
        $config = Get-Content -Encoding utf8 -Raw -LiteralPath $configPath | ConvertFrom-Json
        if ($Owner -and $Owner -ne $config.owner) { throw '当前账号与本机配对配置不符。' }
    }
    Write-Host '复制配对码到「渔 → 即时交易 → ⋯ → 币安 U 本位」。'
    Write-Host $config.token
    & node $entry $directory --live
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
