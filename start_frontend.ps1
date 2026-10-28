# start_frontend.ps1 - Launches the YAM Robotics Lab React + Vite frontend on Windows
$ErrorActionPreference = "Stop"

$FrontendDir = Join-Path $PSScriptRoot "frontend"
Set-Location $FrontendDir

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "[YAM Frontend] Installing npm dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  YAM Robotics Lab - Starting React + Three.js Frontend" -ForegroundColor Cyan
Write-Host "  URL : http://127.0.0.1:5173" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

npm run dev
