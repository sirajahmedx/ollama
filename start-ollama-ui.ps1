[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'open')]
    [string]$Action = 'start',

    [int]$Port = $(if ($env:OLLAMA_UI_PORT) { [int]$env:OLLAMA_UI_PORT } else { 3131 }),

    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSCommandPath
$Url = "http://127.0.0.1:$Port"
$HealthUrl = "$Url/api/health"
$PidFile = Join-Path $Root '.ollama-ui.pid'
$OutLog = Join-Path $Root '.ollama-ui.out.log'
$ErrLog = Join-Path $Root '.ollama-ui.err.log'

function Test-Health {
    param([string]$Uri)
    try {
        $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 2 -ErrorAction Stop
        return $response.ok -eq $true
    } catch {
        return $false
    }
}

function Get-RunningInfo {
    if (-not (Test-Path $PidFile)) { return $null }
    try {
        return Get-Content $PidFile -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Get-ServerProcess {
    $info = Get-RunningInfo
    if ($info -and $info.pid) {
        $process = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
        if ($process) { return $process }
    }

    $serverPath = Join-Path $Root 'server.js'
    try {
        return Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop |
            Where-Object { $_.CommandLine -and $_.CommandLine -like "*$serverPath*" } |
            ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
            Select-Object -First 1
    } catch {
        return $null
    }
}

function Show-Models {
    try {
        $data = Invoke-RestMethod -Uri "$Url/api/models" -TimeoutSec 5 -ErrorAction Stop
        if (-not $data.models -or @($data.models).Count -eq 0) {
            Write-Host '  No local models installed. Pull one with: ollama pull llama3.2:1b' -ForegroundColor DarkYellow
            return
        }
        Write-Host ''
        Write-Host '  Installed models' -ForegroundColor DarkGray
        foreach ($model in @($data.models)) {
            $size = if ($model.size -ge 1GB) {
                '{0:N1} GB' -f ($model.size / 1GB)
            } else {
                '{0:N0} MB' -f ($model.size / 1MB)
            }
            $parameters = if ($model.parameterSize) { $model.parameterSize } else { '' }
            Write-Host ('  [{0}] {1,-18} {2,9}  {3}' -f $model.number, $model.name, $size, $parameters) -ForegroundColor Gray
        }
    } catch {
        Write-Host '  The UI is running, but the model list is not available yet.' -ForegroundColor DarkYellow
    }
}

function Open-Ui {
    if ($NoBrowser) { return }
    Start-Process $Url | Out-Null
}

function Test-Ollama {
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 3 -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Start-Ui {
    if (Test-Health $HealthUrl) {
        Write-Host ''
        Write-Host '  Ollama Terminal UI is already running.' -ForegroundColor Green
        Write-Host "  $Url" -ForegroundColor Cyan
        Show-Models
        Write-Host ''
        Open-Ui
        return
    }

    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        Write-Host '  Node.js 20+ was not found on PATH.' -ForegroundColor Red
        Write-Host '  Install it from https://nodejs.org and try again.' -ForegroundColor DarkYellow
        exit 1
    }

    if (-not (Test-Ollama)) {
        Write-Host ''
        Write-Host '  Warning: Ollama is not responding at 127.0.0.1:11434.' -ForegroundColor Yellow
        Write-Host '  In another terminal run: ollama serve' -ForegroundColor DarkYellow
        Write-Host '  The UI will retry automatically once Ollama is online.' -ForegroundColor DarkGray
    }

    Remove-Item $OutLog, $ErrLog -ErrorAction SilentlyContinue
    $env:OLLAMA_UI_PORT = "$Port"

    $process = Start-Process `
        -FilePath $node `
        -ArgumentList @((Join-Path $Root 'server.js')) `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $OutLog `
        -RedirectStandardError $ErrLog `
        -PassThru

    [ordered]@{
        pid       = $process.Id
        port      = $Port
        url       = $Url
        startedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content -Path $PidFile -Encoding utf8

    $ready = $false
    for ($attempt = 0; $attempt -lt 75; $attempt++) {
        Start-Sleep -Milliseconds 200
        if (Test-Health $HealthUrl) {
            $ready = $true
            break
        }
        if ($process.HasExited) { break }
    }

    if (-not $ready) {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        Write-Host ''
        Write-Host '  Failed to start the local UI server.' -ForegroundColor Red
        if (Test-Path $ErrLog) {
            Get-Content $ErrLog -Tail 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkRed }
        }
        Write-Host "  If port $Port is busy, stop the other process or set OLLAMA_UI_PORT." -ForegroundColor DarkYellow
        exit 1
    }

    Write-Host ''
    Write-Host '  OLLAMA TERMINAL UI' -ForegroundColor Green
    Write-Host "  running at  $Url" -ForegroundColor Cyan
    Write-Host "  server pid  $($process.Id)" -ForegroundColor DarkGray
    Show-Models
    Write-Host ''
    Write-Host '  Alt+1..9 switch model  |  Enter send  |  Ctrl+L clear' -ForegroundColor DarkGray
    Write-Host '  Stop with: ollama-ui stop' -ForegroundColor DarkGray
    Open-Ui
}

function Stop-Ui {
    $process = Get-ServerProcess
    if (-not $process) {
        if (Test-Health $HealthUrl) {
            Write-Host '  The UI responds, but its PID file is missing.' -ForegroundColor Yellow
            try {
                $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
                    Select-Object -First 1
                $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction Stop
                if ($candidate.CommandLine -and $candidate.CommandLine -like '*server.js*') {
                    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
                    Write-Host "  stopped (pid $($connection.OwningProcess))" -ForegroundColor Green
                } else {
                    Write-Host '  Could not safely identify the process holding the port.' -ForegroundColor Red
                }
            } catch {
                Write-Host '  Could not stop the server automatically.' -ForegroundColor Red
            }
        } else {
            Write-Host '  Ollama Terminal UI is not running.' -ForegroundColor DarkYellow
        }
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        return
    }

    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Write-Host "  stopped (pid $($process.Id))" -ForegroundColor Green
}

function Show-Status {
    if (Test-Health $HealthUrl) {
        $info = Get-RunningInfo
        Write-Host ''
        Write-Host '  Ollama Terminal UI is running.' -ForegroundColor Green
        Write-Host "  $Url" -ForegroundColor Cyan
        if ($info -and $info.pid) {
            Write-Host "  server pid  $($info.pid)" -ForegroundColor DarkGray
        }
        Show-Models
    } else {
        Write-Host '  Ollama Terminal UI is not running.' -ForegroundColor DarkYellow
        Write-Host '  Start it with: ollama-ui' -ForegroundColor DarkGray
    }
}

switch ($Action) {
    'start'   { Start-Ui }
    'stop'    { Stop-Ui }
    'restart' { Stop-Ui; Start-Sleep -Milliseconds 600; Start-Ui }
    'status'  { Show-Status }
    'open'    {
        if (-not (Test-Health $HealthUrl)) {
            Write-Host '  The UI is not running. Start it with: ollama-ui' -ForegroundColor DarkYellow
            exit 1
        }
        Start-Process $Url | Out-Null
        Write-Host "  opened $Url" -ForegroundColor Green
    }
}
