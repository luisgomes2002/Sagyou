# Testes do ouvinte do Windows (sem Pester): powershell -NoProfile -File testes.ps1
# O vetor da rede local e a chave PÚBLICA de teste vêm de ../test/vectors.h, o único
# arquivo do firmware com 64 hexadecimais no git.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ouvir-esp32.ps1') -Test

$script:failures = 0
function Assert-Equal($expected, $actual, [string]$name) {
  if ("$expected" -ceq "$actual") {
    Write-Host "ok    $name"
  } else {
    Write-Host "FALHA $name (esperado '$expected', veio '$actual')"
    $script:failures++
  }
}

$vectors = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '..\test\vectors.h')
$keyHex = [regex]::Match($vectors, '#define TEST_KEY_HEX "([0-9a-f]{64})"').Groups[1].Value
$lan = [regex]::Match($vectors, '#define LAN_VECTOR "([^"]+)"').Groups[1].Value
$key = ConvertFrom-SagyouHex $keyHex
$at = [long]1800000000000
$esp = '192.168.15.251'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Bytes([string]$s) { $utf8.GetBytes($s) }
function Check($bytes, $ip = $esp, [long]$last = 0, [long]$now = $at) {
  Test-SagyouLanDatagram -Bytes $bytes -RemoteIp $ip -Esp32Ip $esp -Key $key -LastAt $last -Now $now
}

Assert-Equal 64 $keyHex.Length 'a chave de teste foi lida do vectors.h'
Assert-Equal $true ($lan.StartsWith('sagyou-lan|1|shutdown|1800000000000|')) 'o vetor LAN foi lido'

$r = Check (Bytes $lan)
Assert-Equal 'shutdown' $r.Action 'vetor válido: desliga'
Assert-Equal $at $r.At 'devolve o at para gravar'

Assert-Equal 'origem' (Check (Bytes $lan) '192.168.15.66').Reason 'outro IP: origem'

$long = Bytes ($lan + ('x' * (201 - $lan.Length)))
Assert-Equal 201 $long.Length 'datagrama de 201 bytes montado'
Assert-Equal 'formato' (Check $long).Reason '201 bytes: formato'

$weird = $lan.Replace('|shutdown|', '|format c:|')
Assert-Equal 'formato' (Check (Bytes $weird)).Reason 'comando estranho: formato'

$parts = $lan.Split('|')
$mac = $parts[4]
$flipped = ($(if ($mac[0] -eq 'a') { 'b' } else { 'a' })) + $mac.Substring(1)
$badMac = ($parts[0..3] -join '|') + '|' + $flipped
Assert-Equal 'assinatura' (Check (Bytes $badMac)).Reason 'HMAC trocado num caractere: assinatura'

Assert-Equal 'repetido' (Check (Bytes $lan) $esp $at).Reason 'at igual ao último: repetido'
Assert-Equal 'relógio' (Check (Bytes $lan) $esp 0 ($at + 60001)).Reason 'relógio a mais de 60 s: relógio'
Assert-Equal 'relógio' (Check (Bytes $lan) $esp 0 ($at - 60001)).Reason 'relógio atrasado: relógio'

[byte[]]$notUtf8 = 0xff, 0xfe, 0xfd
Assert-Equal 'formato' (Check $notUtf8).Reason 'bytes que não são UTF-8: formato'

$abortBody = 'sagyou-lan|1|abort-shutdown|1800000000000'
$abort = $abortBody + '|' + (Get-SagyouHmacHex $key $abortBody)
Assert-Equal 'abort-shutdown' (Check (Bytes $abort)).Action 'abort-shutdown válido: cancela'

Assert-Equal $true (Test-SagyouSameText 'abc' 'abc') 'comparação: iguais'
Assert-Equal $false (Test-SagyouSameText 'abc' 'abd') 'comparação: diferentes'
Assert-Equal $false (Test-SagyouSameText 'abc' 'ab') 'comparação: tamanhos diferentes'

# --- instalar.ps1 / desinstalar.ps1 (Task 5) ---
. (Join-Path $PSScriptRoot 'instalar.ps1') -Test
Assert-Equal $true (Test-SagyouIpv4 '192.168.15.251') 'IPv4 válido'
Assert-Equal $false (Test-SagyouIpv4 '999.1.1.1') 'IPv4 com octeto acima de 255'
Assert-Equal $false (Test-SagyouIpv4 '192.168.15') 'IPv4 com 3 octetos'
Assert-Equal $false (Test-SagyouIpv4 'a.b.c.d') 'IPv4 com letras'
Assert-Equal $false (Test-SagyouIpv4 '192.168.15.251; calc') 'IPv4 com sobra'
foreach ($name in 'instalar.ps1', 'desinstalar.ps1', 'ouvir-esp32.ps1') {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors) | Out-Null
  Assert-Equal 0 $errors.Count "$name sem erro de sintaxe"
}

if ($script:failures -gt 0) {
  Write-Host "$script:failures teste(s) falharam."
  exit 1
}
Write-Host 'Todos os testes passaram.'
