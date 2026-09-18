@echo off
cd /d "%~dp0"
where python >nul 2>nul && (python serve.py %* & goto :eof)
where py >nul 2>nul && (py serve.py %* & goto :eof)
npx serve -l 8080 .
