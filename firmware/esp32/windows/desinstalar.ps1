# Desfaz instalar.ps1: tarefa, regras de firewall e as duas pastas (inclui a lan.key).
# Rode como administrador:  .\desinstalar.ps1
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Rode este script como administrador (PowerShell > Executar como administrador).'
}

$taskName = 'Sagyou ESP32'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
foreach ($name in 'Sagyou ESP32 UDP 9999', 'Sagyou ESP32 ping') {
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}
foreach ($dir in (Join-Path $env:ProgramFiles 'Sagyou-ESP32'), (Join-Path $env:ProgramData 'Sagyou-ESP32')) {
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
}
Write-Host 'Ouvinte do ESP32 removido.'
