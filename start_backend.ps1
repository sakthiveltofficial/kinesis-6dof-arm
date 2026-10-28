# start_backend.ps1 - Launches the YAM Robotics Lab FastAPI backend inside WSL2 (Ubuntu-24.04)
$ErrorActionPreference = "Stop"

$WslDistro = "Ubuntu-24.04"
$WslUser = "webnox"
$WslPython = "/home/$WslUser/workspace/mjlab-linux/.venv/bin/python"
$BackendScriptWsl = "/mnt/d/sakthivel workspace/Workspace/RnD/Robotics/backend/main.py"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  YAM Robotics Lab - Starting WSL2 MJLab Backend" -ForegroundColor Cyan
Write-Host "  Distro : $WslDistro (user: $WslUser)" -ForegroundColor Gray
Write-Host "  Python : $WslPython" -ForegroundColor Gray
Write-Host "  API    : http://127.0.0.1:8005" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

wsl.exe -d $WslDistro -u $WslUser -e $WslPython $BackendScriptWsl
