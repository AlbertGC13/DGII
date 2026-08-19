import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const scriptPath = resolve(import.meta.dirname, "../../scripts/invoke-testecf-auth-smoke.ps1");

describe("TesteCF auth smoke launcher static contract", () => {
  it("uses PowerShell 5.1-compatible bounded process APIs", async () => {
    const script = await readFile(scriptPath, "utf8");

    expect(script).toMatch(/\[CmdletBinding\(\)\]/);
    expect(script).toMatch(/\[Parameter\(Mandatory\)\]\s*\[string\]\$CertificatePath/);
    expect(script).toMatch(/\[Parameter\(Mandatory\)\]\s*\[string\]\$Rnc/);
    expect(script).toMatch(/\$Rnc -notmatch '\^\[0-9\]\{9\}\$'/);
    expect(script).toMatch(/\$CertificatePath -notmatch '\^\[A-Za-z\]:\[\\\\\/\]'/);
    expect(script).toMatch(/\.p12' -or/);
    expect(script).toMatch(/Resolve-Path -LiteralPath/);
    expect(script).toMatch(/\$PSScriptRoot/);
    expect(script).toMatch(/testecf-auth-smoke-worker-main\.js/);
    expect(script).toMatch(/Get-Command node/);
    expect(script).toMatch(/\^v24\\\.\\d\+\\\.\\d\+\$/);
    expect(script).toMatch(/Read-Host -AsSecureString/);
    expect(script).toMatch(/SecureStringToBSTR/);
    expect(script).toMatch(/Marshal\]::ReadInt32\(\[IntPtr\]::Add\(\$bstr, -4\)\)/);
    expect(script).toMatch(/Marshal\]::Copy\(\$bstr, \$passwordChars, 0, \$passwordCharCount\)/);
    expect(script).toMatch(/GetBytes\(\$passwordChars\)/);
    expect(script).not.toContain("PtrToStringBSTR");
    expect(script).toMatch(/ZeroFreeBSTR/);
    expect(script).toMatch(/DGS1/);
    expect(script).toMatch(/GetBytes\(\[uint32\]\$pathBytes\.Length\)\.CopyTo\(\$frame, 4\)/);
    expect(script).toMatch(/GetBytes\(\[uint32\]9\)\.CopyTo\(\$frame, 8\)/);
    expect(script).toMatch(/GetBytes\(\[uint32\]\$passwordBytes\.Length\)\.CopyTo\(\$frame, 12\)/);
    expect(script).toMatch(/ProcessStartInfo/);
    expect(script).toMatch(/UseShellExecute = \$false/);
    expect(script).toMatch(/CreateNoWindow = \$true/);
    expect(script).toMatch(/Arguments = \(ConvertTo-WindowsCommandLineArgument \$workerPath\)/);
    expect(script).toMatch(/function ConvertTo-WindowsCommandLineArgument/);
    expect(script).toMatch(/IndexOf\(\[char\]34\) -ge 0/);
    expect(script).toMatch(/trailingBackslashes/);
    expect(script).toContain(String.raw`('\' * $trailingBackslashes)`);
    expect(script).toMatch(/EnvironmentVariables\.Clear\(\)/);
    expect(script).toMatch(/CopyToAsync\(\[System\.IO\.Stream\]::Null\)/);
    expect(script).toMatch(/65536/);
    expect(script).toMatch(/WaitForExit\(35000\)/);
    expect(script).toMatch(/WaitForExit\(5000\)/);
    expect(script).toMatch(/35000/);
    expect(script).toMatch(/\.Kill\(\)/);
    for (const unsupportedApi of ["ArgumentList", "WaitForExitAsync", "IsPathFullyQualified", "Kill($true)", "Kill($false)", ".Environment =", ".Environment["]) {
      expect(script).not.toContain(unsupportedApi);
    }
    expect(script).not.toMatch(/\.Environment\s*[.=]/);
    expect(script).toMatch(/\{"ok":false,"code":"INTERNAL"\}/);
  });

  it("cleans BSTR data immediately after frame construction and before process start", async () => {
    const script = await readFile(scriptPath, "utf8");
    const frameEnd = script.indexOf("$passwordBytes.CopyTo($frame, 16 + $pathBytes.Length + 9)");
    const conversionFinally = script.indexOf("  } finally {", frameEnd);
    const zeroFree = script.indexOf("ZeroFreeBSTR($bstr)", conversionFinally);
    const processStart = script.indexOf("$process.Start()");

    expect(frameEnd).toBeGreaterThan(-1);
    expect(conversionFinally).toBeGreaterThan(frameEnd);
    expect(zeroFree).toBeGreaterThan(conversionFinally);
    expect(processStart).toBeGreaterThan(zeroFree);
    expect(script).toMatch(/if \(\$null -ne \$passwordChars\) \{ \[Array\]::Clear\(\$passwordChars, 0, \$passwordChars\.Length\) \}/);
    expect(script).toMatch(/if \(\$bstr -ne \[IntPtr\]::Zero\) \{ \[Runtime\.InteropServices\.Marshal\]::ZeroFreeBSTR\(\$bstr\); \$bstr = \[IntPtr\]::Zero \}/);
    expect(script).toMatch(/\$securePassword\.Dispose\(\)/);
  });

  it("terminates started workers and drains both redirected streams before disposal", async () => {
    const script = await readFile(scriptPath, "utf8");
    const cleanupFinally = script.lastIndexOf("} finally {");
    const cleanup = script.slice(cleanupFinally);

    expect(cleanup).toMatch(/if \(\$processStarted\) \{[\s\S]*\.Kill\(\)[\s\S]*WaitForExit\(5000\)/);
    expect(cleanup).toMatch(/Wait-TaskBounded \$stdoutTask 5000/);
    expect(cleanup).toMatch(/Wait-TaskBounded \$stderrTask 5000/);
    expect(cleanup.indexOf("Wait-TaskBounded $stdoutTask 5000")).toBeLessThan(cleanup.indexOf("$process.Dispose()"));
    expect(cleanup.indexOf("Wait-TaskBounded $stderrTask 5000")).toBeLessThan(cleanup.indexOf("$process.Dispose()"));
  });

  it("rejects reparse points throughout repository and certificate ancestries", async () => {
    const script = await readFile(scriptPath, "utf8");

    expect(script).toMatch(/function Assert-NoReparsePointAncestry/);
    expect(script).toMatch(/Get-Item -LiteralPath \$current -Force/);
    expect(script).toMatch(/\[IO\.FileAttributes\]::ReparsePoint/);
    expect(script).toMatch(/Assert-NoReparsePointAncestry \$repoRoot/);
    expect(script).toMatch(/Assert-NoReparsePointAncestry \$candidateCertificatePath/);
    expect(script).toMatch(/Assert-NoReparsePointAncestry \$canonicalCertificatePath/);
    expect(script).toMatch(/function Add-TrailingDirectorySeparator/);
    expect(script).toMatch(/StartsWith\(\$repoPrefix, \[StringComparison\]::OrdinalIgnoreCase\)/);
    expect(script).toMatch(/Resolve-Path -LiteralPath \$certificate\.FullName/);
  });

  it("rejects risky execution mechanisms and secret-bearing channels", async () => {
    const script = await readFile(scriptPath, "utf8");
    const requiredEnvironment = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY", "GLOBAL_AGENT_HTTP_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_OPTIONS"];

    for (const name of requiredEnvironment) expect(script).toContain(name);
    for (const forbidden of ["Start-Process", "Invoke-Expression", "Write-Verbose", "Write-Debug", "-ExecutionPolicy", "ConvertFrom-SecureString"]) expect(script).not.toContain(forbidden);
    expect(script).not.toMatch(/\$CertificatePassword/);
    expect(script).not.toMatch(/\$\(\$password/);
    expect(script).toMatch(/Start-Transcript|transcribing/i);
    expect(script).toMatch(/"ok":false,"code":"/);
  });

  it("parses under Windows PowerShell when the host is available", () => {
    const systemRoot = process.env["SystemRoot"];
    const powershellPath = systemRoot ? resolve(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";

    if (!existsSync(powershellPath)) return;

    const command = "$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($env:TESTECF_LAUNCHER_SCRIPT_PATH,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.ToString()};exit 1}";
    expect(() => execFileSync(powershellPath, ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      env: { ...process.env, TESTECF_LAUNCHER_SCRIPT_PATH: scriptPath },
    })).not.toThrow();
  });
});
