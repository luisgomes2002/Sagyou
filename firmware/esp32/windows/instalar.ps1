# Instala o ouvinte do ESP32 no Windows (spec docs/specs/2026-11-07-esp32-firmware.md).
# Rode como administrador:  .\instalar.ps1 -Esp32Ip 192.168.15.251
#
# - copia ouvir-esp32.ps1 para C:\Program Files\Sagyou-ESP32\ (só administradores
#   escrevem ali: o usuário comum não troca o script que roda como SYSTEM);
# - cria C:\ProgramData\Sagyou-ESP32\ só para SYSTEM e Administradores, com a lan.key;
# - gera a LAN_KEY se ainda não existir e a mostra UMA vez (vai para o secrets.h);
# - cria a tarefa "Sagyou ESP32" (ao iniciar, como SYSTEM, reinicia se cair);
# - libera no firewall só o IP do ESP32: UDP 9999 e ping.
param(
  # Só carrega as funções (para testes.ps1).
  [switch]$Test,
  [string]$Esp32Ip
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

function Test-SagyouIpv4([string]$Ip) {
  $m = [regex]::Match("$Ip", '\A([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\z')
  if (-not $m.Success) { return $false }
  foreach ($i in 1..4) { if ([int]$m.Groups[$i].Value -gt 255) { return $false } }
  return $true
}

if ($Test) { return }

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Rode este script como administrador (PowerShell > Executar como administrador).'
}
if (-not (Test-SagyouIpv4 $Esp32Ip)) { throw 'Informe o IP do ESP32: -Esp32Ip 192.168.15.251' }

$programDir = Join-Path $env:ProgramFiles 'Sagyou-ESP32'
$dataDir = Join-Path $env:ProgramData 'Sagyou-ESP32'
$listener = Join-Path $programDir 'ouvir-esp32.ps1'

# 1. O script, onde só administradores escrevem.
New-Item -ItemType Directory -Force -Path $programDir | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'ouvir-esp32.ps1') $listener

# 2. Os dados, só para SYSTEM e Administradores (herança desligada).
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in 'S-1-5-18', 'S-1-5-32-544') {
  $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -Path $dataDir -AclObject $acl

# 3. A LAN_KEY: gerada uma vez; mostrada só agora.
$keyFile = Join-Path $dataDir 'lan.key'
if (Test-Path $keyFile) {
  Write-Host 'A LAN_KEY já existe e não é mostrada de novo. Para trocar: apague'
  Write-Host "$keyFile, rode este script de novo e grave o firmware com a nova."
} else {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $hex = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  Set-Content -Encoding ASCII -Path $keyFile -Value $hex
  Write-Host ''
  Write-Host 'LAN_KEY (copie para o secrets.h do firmware; ela não aparece de novo):'
  Write-Host "  #define LAN_KEY `"$hex`""
  Write-Host ''
}

# 4. A tarefa agendada, como SYSTEM.
$taskName = 'Sagyou ESP32'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$listener`" -Esp32Ip $Esp32Ip"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $taskPrincipal -Settings $settings -Force | Out-Null
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskName

# 5. Firewall: só o IP do ESP32.
foreach ($name in 'Sagyou ESP32 UDP 9999', 'Sagyou ESP32 ping') {
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}
New-NetFirewallRule -DisplayName 'Sagyou ESP32 UDP 9999' -Direction Inbound -Protocol UDP `
  -LocalPort 9999 -RemoteAddress $Esp32Ip -Action Allow -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Sagyou ESP32 ping' -Direction Inbound -Protocol ICMPv4 `
  -IcmpType 8 -RemoteAddress $Esp32Ip -Action Allow -Profile Any | Out-Null

Write-Host "Pronto. Ouvinte em $listener, só para o ESP32 $Esp32Ip."
Write-Host "Log: $(Join-Path $dataDir 'ouvinte.log')"
