@echo off
REM Blackout Arena launcher (Windows)
where python >nul 2>nul && (python "%~dp0serve.py" %1 & goto :eof)
where py >nul 2>nul && (py "%~dp0serve.py" %1 & goto :eof)
where node >nul 2>nul && (npx --yes serve "%~dp0" & goto :eof)
echo Could not find Python or Node. Install either one, or open index.html through any local web server.
pause
