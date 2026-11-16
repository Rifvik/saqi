@echo off
setlocal
cd /d "%~dp0"
echo === Saqi (Salt-Smart Desert Irrigation) Launcher ===

where node >nul 2>nul
if %errorlevel%==0 (
  echo Running JS engine tests...
  node --test tests\engine.test.js
)

set "PYCMD="
where py >nul 2>nul
if %errorlevel%==0 set "PYCMD=py -3"
if "%PYCMD%"=="" (
  where python >nul 2>nul
  if %errorlevel%==0 set "PYCMD=python"
)

if not "%PYCMD%"=="" (
  echo Checking Python AI tests...
  %PYCMD% -m unittest discover -s tests
  echo Starting Saqi server at http://localhost:8765 ...
  start "" "http://localhost:8765/index.html"
  %PYCMD% server.py
  goto :eof
)

where npx >nul 2>nul
if %errorlevel%==0 (
  echo Python not found; starting static fallback via npx serve at http://localhost:8765 ...
  start "" "http://localhost:8765/index.html"
  npx --yes serve -l 8765 .
  goto :eof
)

echo Please install Python 3.10+ or Node.js to run Saqi locally.
pause
