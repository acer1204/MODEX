@echo off
REM ============================================================
REM  MODEX - one-click launcher
REM  Starts the local server and opens the web UI in your browser.
REM ============================================================
setlocal
cd /d "%~dp0"
title MODEX

REM --- pick a Python command (the "py" launcher is preferred) ---
set "PY=py"
where py >nul 2>nul || set "PY=python"
where %PY% >nul 2>nul || (
  echo [MODEX] Python not found. Install Python 3.10+ from https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

REM --- first run: install dependencies if Flask is missing ---
%PY% -c "import flask" >nul 2>nul || (
  echo [MODEX] Installing dependencies, please wait...
  %PY% -m pip install -r requirements.txt || (
    echo [MODEX] Dependency install failed.
    echo.
    pause
    exit /b 1
  )
)

REM --- open the web UI a couple of seconds after the server starts ---
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & explorer http://127.0.0.1:8811/"

echo.
echo [MODEX] Server running at http://127.0.0.1:8811/
echo [MODEX] Close this window to stop the server.
echo.
%PY% app.py

echo.
echo [MODEX] Server stopped.
pause
