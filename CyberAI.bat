@echo off
chcp 65001 >nul
title CYBER AI (fermer cette fenetre arrete CYBER AI)
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo CYBER AI n'est pas installe : lance d'abord install.bat
  pause & exit /b 1
)
REM Demarre Ollama s'il ne tourne pas deja
tasklist /fi "imagename eq ollama.exe" | find /i "ollama.exe" >nul || (start "" /min ollama serve)
"backend\.venv\Scripts\python.exe" backend\run.py %*
if errorlevel 1 pause
