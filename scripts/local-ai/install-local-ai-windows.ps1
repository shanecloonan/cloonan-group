# Install Ollama on Windows and create a "Local AI" desktop shortcut.
# Run in PowerShell: irm https://raw.githubusercontent.com/shanecloonan/cloonan-group/cursor/ollama-local-ai-launcher-522a/scripts/local-ai/install-local-ai-windows.ps1 | iex
# Or from this repo:  .\scripts\local-ai\install-local-ai-windows.ps1

$ErrorActionPreference = "Stop"
$Model = if ($env:LOCAL_AI_MODEL) { $env:LOCAL_AI_MODEL } else { "qwen2.5:0.5b" }

Write-Host ">>> Installing Ollama..." -ForegroundColor Cyan
irm https://ollama.com/install.ps1 | iex

$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
    $ollamaPath = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (-not (Test-Path $ollamaPath)) {
        throw "Ollama install finished but ollama.exe was not found. Restart PowerShell and run this script again."
    }
    $env:Path += ";$(Split-Path $ollamaPath)"
}

Write-Host ">>> Pulling model: $Model (about 400 MB)..." -ForegroundColor Cyan
ollama pull $Model

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Local AI.lnk"

$iconCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
    (Join-Path $env:ProgramFiles "Ollama\ollama app.exe"),
    (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
)
$iconTarget = $iconCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iconTarget) { $iconTarget = "ollama.exe" }

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $iconTarget
$shortcut.Arguments = ""
$shortcut.WorkingDirectory = $env:USERPROFILE
$shortcut.Description = "Local AI chat (Ollama)"
$shortcut.IconLocation = "$iconTarget,0"
$shortcut.Save()

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Desktop shortcut: $shortcutPath"
Write-Host "  Double-click 'Local AI' on your desktop, or run:  ollama run $Model"
Write-Host "  Ollama also runs from the system tray (llama icon near the clock)."
