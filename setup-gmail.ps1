$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot '.env'
if (!(Test-Path -LiteralPath $configPath)) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.env.example') -Destination $configPath
}
$config = [System.IO.File]::ReadAllText($configPath)
function Set-ConfigValue([string]$key, [string]$value) {
    $pattern = '(?m)^' + [regex]::Escape($key) + '=.*$'
    if ([regex]::IsMatch($script:config, $pattern)) {
        $script:config = [regex]::Replace($script:config, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $key + '=' + $value })
    } else {
        $script:config += "`r`n$key=$value"
    }
}
function Read-PrivateValue([string]$label) {
    $secureValue = Read-Host $label -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
if ($config -notmatch '(?m)^ADMIN_PASSWORD=\S+') {
    $adminValue = Read-PrivateValue 'Admin paneli icin ozel bir sifre girin'
    if ($adminValue.Length -lt 12) { throw 'Admin sifresi en az 12 karakter olmali.' }
    Set-ConfigValue 'ADMIN_PASSWORD' $adminValue
    $adminValue = $null
}
$mailSecret = (Read-PrivateValue 'highweartr@gmail.com icin 16 karakterlik Google UYGULAMA sifresini girin').Replace(' ', '')
if ($mailSecret -notmatch '^[a-zA-Z]{16}$') { throw 'Google uygulama sifresi 16 harften olusur. Iki asamali giris kodunu kullanmayin.' }
Set-ConfigValue 'GMAIL_USER' 'highweartr@gmail.com'
Set-ConfigValue 'GMAIL_APP_PASSWORD' $mailSecret
Set-ConfigValue 'MAIL_ENABLED' 'true'
Set-ConfigValue 'MAIL_FROM_NAME' 'AUREN FASHION'
[System.IO.File]::WriteAllText($configPath, $config, (New-Object System.Text.UTF8Encoding($false)))
$mailSecret = $null
$config = $null
Write-Host 'Gmail ayarlari yerel .env dosyasina kaydedildi. Sifre ekrana yazilmadi.'
Write-Host 'npm install, ardindan npm start komutunu calistirin. Acik sunucu varsa yeniden baslatin.'
