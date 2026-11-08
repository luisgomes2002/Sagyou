# Ouvinte do ESP32 no Windows (spec docs/specs/2026-11-07-esp32-firmware.md).
#
# Roda como SYSTEM (tarefa agendada "Sagyou ESP32", criada por instalar.ps1) para
# continuar funcionando mesmo se a conta do usuário for invadida: é o último
# recurso para desligar o PC. Por isso é mínimo e estrito:
#   - aceita só UDP 9999 do IP do ESP32 (o firewall já filtra; aqui é a 2ª camada);
#   - só o formato exato sagyou-lan|1|<cmd>|<at>|<hmac>, no máximo 200 bytes;
#   - HMAC-SHA256 com a LAN_KEY, comparado em tempo constante;
#   - at maior que o último aceito (guardado antes de agir) e a até 60 s do relógio;
#   - executa só o shutdown.exe do System32 com argumentos fixos: nada do
#     datagrama vira argumento, caminho ou comando.
param(
  # Só carrega as funções (para testes.ps1); não abre a porta.
  [switch]$Test,
  [string]$Esp32Ip,
  [string]$DataDir = (Join-Path $env:ProgramData 'Sagyou-ESP32')
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$script:LanPort = 9999
$script:MaxBytes = 200
$script:ClockSkewMs = 60000
$script:Pattern = [regex]'\Asagyou-lan\|1\|(shutdown|abort-shutdown)\|([0-9]{13})\|([0-9a-f]{64})\z'
$script:StrictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$script:ShutdownExe = Join-Path $env:SystemRoot 'System32\shutdown.exe'

function ConvertFrom-SagyouHex([string]$Hex) {
  if ($Hex -notmatch '\A[0-9a-fA-F]{64}\z') { throw 'chave inválida: esperados 64 hexadecimais' }
  [byte[]]$out = New-Object byte[] 32
  for ($i = 0; $i -lt 32; $i++) { $out[$i] = [Convert]::ToByte($Hex.Substring(2 * $i, 2), 16) }
  return , $out
}

function Get-SagyouHmacHex([byte[]]$Key, [string]$Text) {
  $hmac = New-Object System.Security.Cryptography.HMACSHA256 (, $Key)
  try {
    $digest = $hmac.ComputeHash($script:StrictUtf8.GetBytes($Text))
  } finally {
    $hmac.Dispose()
  }
  return (($digest | ForEach-Object { $_.ToString('x2') }) -join '')
}

# Same length and content, without leaving early on the first difference.
function Test-SagyouSameText([string]$A, [string]$B) {
  if ($A.Length -ne $B.Length) { return $false }
  $diff = 0
  for ($i = 0; $i -lt $A.Length; $i++) { $diff = $diff -bor ([int][char]$A[$i] -bxor [int][char]$B[$i]) }
  return $diff -eq 0
}

# The whole decision, with no side effect. Action: shutdown, abort-shutdown or
# $null; Reason (when refused): origem, formato, assinatura, repetido, relógio.
function Test-SagyouLanDatagram {
  param(
    [byte[]]$Bytes,
    [string]$RemoteIp,
    [string]$Esp32Ip,
    [byte[]]$Key,
    [long]$LastAt,
    [long]$Now
  )
  $refuse = { param($reason) @{ Action = $null; Reason = $reason; At = $null } }
  if ($RemoteIp -ne $Esp32Ip) { return & $refuse 'origem' }
  if ($null -eq $Bytes -or $Bytes.Length -eq 0 -or $Bytes.Length -gt $script:MaxBytes) {
    return & $refuse 'formato'
  }
  try {
    $text = $script:StrictUtf8.GetString($Bytes)
  } catch {
    return & $refuse 'formato'
  }
  $m = $script:Pattern.Match($text)
  if (-not $m.Success) { return & $refuse 'formato' }
  $cmd = $m.Groups[1].Value
  $at = [long]$m.Groups[2].Value
  $expected = Get-SagyouHmacHex $Key ("sagyou-lan|1|$cmd|" + $m.Groups[2].Value)
  if (-not (Test-SagyouSameText $expected $m.Groups[3].Value)) { return & $refuse 'assinatura' }
  if ($at -le $LastAt) { return & $refuse 'repetido' }
  if ([math]::Abs($at - $Now) -gt $script:ClockSkewMs) { return & $refuse 'relógio' }
  return @{ Action = $cmd; Reason = $null; At = $at }
}

function Write-SagyouLog([string]$Line) {
  $log = Join-Path $DataDir 'ouvinte.log'
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) {
    Move-Item -Force $log (Join-Path $DataDir 'ouvinte.log.1')
  }
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -Encoding UTF8 -Path $log -Value "$stamp $Line"
}

function Get-SagyouLastAt {
  $file = Join-Path $DataDir 'ultimo-at.txt'
  if (-not (Test-Path $file)) { return [long]0 }
  $value = (Get-Content -Raw $file).Trim()
  if ($value -match '\A[0-9]{1,19}\z') { return [long]$value }
  return [long]0
}

function Start-SagyouListener {
  if (-not $Esp32Ip) { throw 'Informe -Esp32Ip.' }
  $key = ConvertFrom-SagyouHex ((Get-Content -Raw (Join-Path $DataDir 'lan.key')).Trim())
  $endpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, $script:LanPort)
  $udp = New-Object System.Net.Sockets.UdpClient($endpoint)
  Write-SagyouLog "ouvindo UDP $($script:LanPort) do ESP32 $Esp32Ip"
  try {
    while ($true) {
      $remote = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
      $bytes = $udp.Receive([ref]$remote)
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $r = Test-SagyouLanDatagram -Bytes $bytes -RemoteIp $remote.Address.ToString() `
        -Esp32Ip $Esp32Ip -Key $key -LastAt (Get-SagyouLastAt) -Now $now
      if (-not $r.Action) {
        Write-SagyouLog "recusado: $($r.Reason)"
        continue
      }
      # The counter is saved before acting: a restart never runs it twice.
      Set-Content -Encoding ASCII -Path (Join-Path $DataDir 'ultimo-at.txt') -Value $r.At
      if ($r.Action -eq 'shutdown') {
        & $script:ShutdownExe /s /t 60 /c 'Sagyou: desligando pelo ESP32'
      } else {
        & $script:ShutdownExe /a
      }
      Write-SagyouLog "executou: $($r.Action)"
    }
  } finally {
    $udp.Dispose()
  }
}

if (-not $Test) { Start-SagyouListener }
