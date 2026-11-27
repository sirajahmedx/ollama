[CmdletBinding()]
param(
    [switch]$CreateDesktopShortcut
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSCommandPath
$Launcher = Join-Path $Root 'start-ollama-ui.ps1'
if (-not (Test-Path $Launcher)) {
    throw "Launcher not found at $Launcher"
}

$profilePath = $PROFILE.CurrentUserAllHosts
$profileDir = Split-Path -Parent $profilePath
if (-not (Test-Path $profileDir)) {
    New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
}

$markerStart = '# >>> ollama-ui shortcut >>>'
$markerEnd = '# <<< ollama-ui shortcut <<<'
$block = @"
$markerStart
function ollama-ui {
    param(
        [Parameter(Position = 0)]
        [ValidateSet('start', 'stop', 'restart', 'status', 'open')]
        [string]`$Action = 'start'
    )
    & '$Launcher' -Action `$Action
}
$markerEnd
"@

$content = ''
if (Test-Path $profilePath) {
    $content = Get-Content $profilePath -Raw
    Copy-Item $profilePath "$profilePath.bak" -Force
}

if ($content -match [regex]::Escape($markerStart)) {
    $pattern = '(?s)' + [regex]::Escape($markerStart) + '.*?' + [regex]::Escape($markerEnd)
    $content = [regex]::Replace(
        $content,
        $pattern,
        [System.Text.RegularExpressions.MatchEvaluator] { param($match) $block }
    )
} else {
    $content = $content.TrimEnd() + "`r`n`r`n" + $block + "`r`n"
}

Set-Content -Path $profilePath -Value $content -Encoding utf8

Write-Host ''
Write-Host '  ollama-ui shortcut installed.' -ForegroundColor Green
Write-Host "  profile: $profilePath" -ForegroundColor DarkGray
Write-Host '  Open a new PowerShell window and run: ollama-ui' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Commands:' -ForegroundColor DarkGray
Write-Host '    ollama-ui          launch the server and open the browser' -ForegroundColor Gray
Write-Host '    ollama-ui status   show server status and installed models' -ForegroundColor Gray
Write-Host '    ollama-ui stop     stop the background server' -ForegroundColor Gray
Write-Host '    ollama-ui restart  restart the server' -ForegroundColor Gray
Write-Host ''

if ($CreateDesktopShortcut) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop 'Ollama Terminal UI.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $Root 'ollama-ui.cmd'
    $shortcut.WorkingDirectory = $Root
    $shortcut.Description = 'Local Ollama terminal UI'
    $shortcut.Save()
    Write-Host "  desktop shortcut: $shortcutPath" -ForegroundColor Green
    Write-Host ''
}
