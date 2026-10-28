# start_web_demo.ps1 - One-click Windows Launcher for YAM Robotics Lab
# Starts the WSL2 MJLab + ONNX backend, starts the Windows React + Three.js frontend,
# verifies health endpoints, and opens the Windows browser.

param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$FrontendDir = Join-Path $ProjectRoot "frontend"
$WslDistro = "Ubuntu-24.04"
$WslUser = "webnox"
$WslUncRoot = "\\wsl.localhost\$WslDistro\home\$WslUser\workspace\mjlab-linux"
$WslPython = "/home/$WslUser/workspace/mjlab-linux/.venv/bin/python"
$BackendScriptWsl = "/mnt/d/sakthivel workspace/Workspace/RnD/Robotics/backend/main.py"
$BackendUrl = "http://127.0.0.1:8005/api/health"
$FrontendUrl = "http://127.0.0.1:5173"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  YAM Robotics Lab - Windows + WSL2 MJLab Pick and Place Simulator" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Verify WSL UNC assets
if (-not (Test-Path "$WslUncRoot\logs\rsl_rl\yam_lift_cube\2026-10-28_05-58-03\2026-10-28_05-58-03.onnx")) {
    throw "Required ONNX model not found at $WslUncRoot\logs\rsl_rl\yam_lift_cube\2026-10-28_05-58-03\2026-10-28_05-58-03.onnx"
}
Write-Host "[1/4] Verified WSL2 MJLab repository and ONNX model via UNC path." -ForegroundColor Green

# 2. Start Backend if not already listening on port 8005
$BackendReady = $false
try {
    $resp = Invoke-RestMethod -Uri $BackendUrl -TimeoutSec 2 -ErrorAction Stop
    if ($resp.status -eq "ok") {
        $BackendReady = $true
        Write-Host "[2/4] WSL2 Backend is already running on http://127.0.0.1:8005" -ForegroundColor Green
    }
} catch {}

if (-not $BackendReady) {
    Write-Host "[2/4] Launching WSL2 MJLab FastAPI backend..." -ForegroundColor Yellow
    Start-Process -FilePath "wsl.exe" `
        -ArgumentList @("-d", $WslDistro, "-u", $WslUser, "-e", $WslPython, $BackendScriptWsl) `
        -WindowStyle Minimized

    $maxWait = 60
    for ($i = 1; $i -le $maxWait; $i++) {
        Start-Sleep -Seconds 1
        try {
            $resp = Invoke-RestMethod -Uri $BackendUrl -TimeoutSec 2 -ErrorAction Stop
            if ($resp.status -eq "ok") {
                $BackendReady = $true
                Write-Host "      Backend ready! Task: $($resp.task_id), Device: $($resp.device)" -ForegroundColor Green
                break
            }
        } catch {}
    }
    if (-not $BackendReady) {
        throw "Backend failed to become healthy on $BackendUrl within $maxWait seconds."
    }
}

# 3. Start Frontend if not already listening on port 5173
if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "[3/4] Installing frontend npm packages..." -ForegroundColor Yellow
    Push-Location $FrontendDir
    npm install
    Pop-Location
}

$FrontendReady = $false
try {
    $fResp = Invoke-WebRequest -Uri $FrontendUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($fResp.StatusCode -eq 200) {
        $FrontendReady = $true
        Write-Host "[3/4] Frontend is already running on $FrontendUrl" -ForegroundColor Green
    }
} catch {}

if (-not $FrontendReady) {
    Write-Host "[3/4] Launching Vite React Frontend on $FrontendUrl..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/c", "npm run dev") `
        -WorkingDirectory $FrontendDir `
        -WindowStyle Minimized

    for ($i = 1; $i -le 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $fResp = Invoke-WebRequest -Uri $FrontendUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($fResp.StatusCode -eq 200) {
                $FrontendReady = $true
                Write-Host "      Frontend ready on $FrontendUrl!" -ForegroundColor Green
                break
            }
        } catch {}
    }
    if (-not $FrontendReady) {
        throw "Frontend failed to start on $FrontendUrl"
    }
}

# 4. Open Windows Browser
if (-not $NoBrowser) {
    Write-Host "[4/4] Opening YAM Robotics Lab in Windows default browser..." -ForegroundColor Green
    Start-Process $FrontendUrl
} else {
    Write-Host "[4/4] YAM Robotics Lab is live at $FrontendUrl" -ForegroundColor Green
}

Write-Host ""
Write-Host "YAM Robotics Lab is running!" -ForegroundColor Cyan
Write-Host "  Frontend UI : $FrontendUrl" -ForegroundColor White
Write-Host "  Backend API : $BackendUrl" -ForegroundColor White
