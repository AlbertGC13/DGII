[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$CertificatePath,
  [Parameter(Mandatory)] [string]$Rnc
)

$ErrorActionPreference = 'Stop'
$result = '{"ok":false,"code":"INTERNAL"}'
$exitCode = 4
$bstr = [IntPtr]::Zero
$pathBytes = $null; $rncBytes = $null; $passwordBytes = $null; $passwordChars = $null; $frame = $null
$process = $null; $processStarted = $false; $stdoutTask = $null; $stderrTask = $null
$utf8 = [Text.UTF8Encoding]::new($false, $true)

function Assert-NoReparsePointAncestry([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  $rootItem = Get-Item -LiteralPath $root -Force
  if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point in path ancestry' }

  $current = $root
  foreach ($segment in $fullPath.Substring($root.Length).Split([char[]]@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries)) {
    $current = Join-Path -Path $current -ChildPath $segment
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point in path ancestry' }
  }
}

function Add-TrailingDirectorySeparator([string]$Path) {
  if ($Path.EndsWith('\') -or $Path.EndsWith('/')) { return $Path }
  return $Path + [IO.Path]::DirectorySeparatorChar
}

function ConvertTo-WindowsCommandLineArgument([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.IndexOf([char]34) -ge 0) { throw 'unsafe worker path' }
  $trailingBackslashes = 0
  for ($index = $Value.Length - 1; $index -ge 0 -and $Value[$index] -eq '\'; $index--) { $trailingBackslashes++ }
  return '"' + $Value + ('\' * $trailingBackslashes) + '"'
}

function Wait-TaskBounded([Threading.Tasks.Task]$Task, [int]$TimeoutMilliseconds) {
  if ($null -eq $Task) { return }
  if (-not $Task.Wait($TimeoutMilliseconds)) { throw 'stream drain timeout' }
  return ,$Task.GetAwaiter().GetResult()
}

try {
  if ($DebugPreference -ne 'SilentlyContinue' -or $VerbosePreference -ne 'SilentlyContinue' -or
    (Get-Variable -Name transcribing -Scope Global -ErrorAction SilentlyContinue) -or
    (Get-Variable -Name Transcript -Scope Global -ErrorAction SilentlyContinue)) { throw 'unsafe host state' }
  if ($Rnc -notmatch '^[0-9]{9}$') { throw 'invalid rnc' }
  if ($CertificatePath -notmatch '^[A-Za-z]:[\\/]') { throw 'relative certificate path' }

  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  Assert-NoReparsePointAncestry $repoRoot
  $candidateCertificatePath = [System.IO.Path]::GetFullPath($CertificatePath)
  Assert-NoReparsePointAncestry $candidateCertificatePath
  $certificate = Get-Item -LiteralPath $candidateCertificatePath -Force
  if ($certificate -isnot [IO.FileInfo] -or $certificate.PSIsContainer -or ($certificate.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    $certificate.Extension -cne '.p12' -or $certificate.Length -lt 1 -or $certificate.Length -gt 16777216) { throw 'invalid certificate' }
  $canonicalCertificatePath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $certificate.FullName).Path)
  Assert-NoReparsePointAncestry $canonicalCertificatePath
  $repoPrefix = Add-TrailingDirectorySeparator $repoRoot
  if ($canonicalCertificatePath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'certificate inside repository' }
  $workerPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'dist/internal/testecf-auth-smoke-worker-main.js'))
  if (-not (Test-Path -LiteralPath $workerPath -PathType Leaf)) { throw 'missing build output' }

  $prohibited = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'GLOBAL_AGENT_HTTP_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_OPTIONS')
  foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) {
    if ($prohibited -contains $entry.Key.ToUpperInvariant()) { throw 'unsafe environment' }
  }
  $node = Get-Command node -CommandType Application | Select-Object -First 1
  if ($null -eq $node -or ((& $node.Source --version 2>$null) -notmatch '^v24\.\d+\.\d+$')) { throw 'node 24 required' }

  $securePassword = Read-Host -AsSecureString 'Certificate password'
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $passwordByteLength = [Runtime.InteropServices.Marshal]::ReadInt32([IntPtr]::Add($bstr, -4))
    if ($passwordByteLength -lt 2 -or $passwordByteLength -gt 2048 -or ($passwordByteLength % 2) -ne 0) { throw 'invalid password' }
    $passwordCharCount = [int]($passwordByteLength / 2)
    $passwordChars = [char[]]::new($passwordCharCount)
    [Runtime.InteropServices.Marshal]::Copy($bstr, $passwordChars, 0, $passwordCharCount)
    $pathBytes = $utf8.GetBytes($canonicalCertificatePath)
    $rncBytes = [Text.Encoding]::UTF8.GetBytes($Rnc)
    $passwordBytes = $utf8.GetBytes($passwordChars)
    if ($pathBytes.Length -lt 1 -or $pathBytes.Length -gt 4096 -or $rncBytes.Length -ne 9 -or
      $passwordBytes.Length -lt 1 -or $passwordBytes.Length -gt 1024 -or $passwordBytes -contains 0) { throw 'invalid frame' }
    $frame = [byte[]]::new(16 + $pathBytes.Length + 9 + $passwordBytes.Length)
    [Text.Encoding]::ASCII.GetBytes('DGS1').CopyTo($frame, 0)
    [BitConverter]::GetBytes([uint32]$pathBytes.Length).CopyTo($frame, 4)
    [BitConverter]::GetBytes([uint32]9).CopyTo($frame, 8)
    [BitConverter]::GetBytes([uint32]$passwordBytes.Length).CopyTo($frame, 12)
    $pathBytes.CopyTo($frame, 16); $rncBytes.CopyTo($frame, 16 + $pathBytes.Length); $passwordBytes.CopyTo($frame, 16 + $pathBytes.Length + 9)
  } finally {
    if ($null -ne $passwordChars) { [Array]::Clear($passwordChars, 0, $passwordChars.Length) }
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $bstr = [IntPtr]::Zero }
  }

  if ($null -eq ('BoundedDrain' -as [type])) {
    Add-Type -TypeDefinition @'
using System; using System.IO; using System.Threading.Tasks;
public static class BoundedDrain {
  public static async Task<byte[]> ReadAsync(Stream input, int maximum) {
    using (var output = new MemoryStream()) { var buffer = new byte[8192]; int read; bool exceeded = false;
      while ((read = await input.ReadAsync(buffer, 0, buffer.Length)) != 0) { if (output.Length + read > maximum) exceeded = true; else output.Write(buffer, 0, read); }
      Array.Clear(buffer, 0, buffer.Length); if (exceeded) throw new InvalidDataException(); return output.ToArray(); }
  }
}
'@
  }
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $node.Source; $startInfo.Arguments = (ConvertTo-WindowsCommandLineArgument $workerPath)
  $startInfo.UseShellExecute = $false; $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true; $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables.Clear()
  foreach ($name in @('SystemRoot', 'WINDIR', 'PATH')) { $value = [Environment]::GetEnvironmentVariable($name); if ($null -ne $value) { $startInfo.EnvironmentVariables[$name] = $value } }
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'process start failed' }
  $processStarted = $true
  $stdoutTask = [BoundedDrain]::ReadAsync($process.StandardOutput.BaseStream, 65536)
  $stderrTask = $process.StandardError.BaseStream.CopyToAsync([System.IO.Stream]::Null)
  $process.StandardInput.BaseStream.Write($frame, 0, $frame.Length); $process.StandardInput.BaseStream.Flush(); $process.StandardInput.Close()
  if (-not $process.WaitForExit(35000)) {
    # The Node worker spawns no children, so Kill() terminates the complete worker process.
    $process.Kill(); [void]$process.WaitForExit(5000); throw 'worker timeout'
  }
  $outputBytes = Wait-TaskBounded $stdoutTask 5000
  $ignored = Wait-TaskBounded $stderrTask 5000
  $output = $utf8.GetString($outputBytes)
  if ($output -eq "{`"ok`":true,`"code`":`"TESTECF_AUTH_SUCCEEDED`"}`n" -and $process.ExitCode -eq 0) { $result = '{"ok":true,"code":"TESTECF_AUTH_SUCCEEDED"}'; $exitCode = 0 }
  elseif ($output -eq "{`"ok`":false,`"code`":`"TESTECF_AUTH_FAILED`"}`n" -and $process.ExitCode -eq 3) { $result = '{"ok":false,"code":"TESTECF_AUTH_FAILED"}'; $exitCode = 3 }
} catch { } finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  foreach ($bytes in @($pathBytes, $rncBytes, $passwordBytes, $frame)) { if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) } }
  if ($null -ne $securePassword) { $securePassword.Dispose() }
  if ($null -ne $process) {
    if ($processStarted) {
      try { if (-not $process.HasExited) { $process.Kill() } } catch { try { $process.Kill() } catch { } }
      try { [void]$process.WaitForExit(5000) } catch { }
    }
    try { $ignored = Wait-TaskBounded $stdoutTask 5000 } catch { }
    try { $ignored = Wait-TaskBounded $stderrTask 5000 } catch { }
    $process.Dispose()
  }
  [Console]::Out.Write($result + [Environment]::NewLine)
  exit $exitCode
}
