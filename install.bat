@echo off
chcp 65001 >nul
setlocal
title Installation de CYBER AI
cd /d "%~dp0"
echo.
echo  ==========================================================
echo     CYBER AI - installation (tout reste sur ce PC)
echo  ==========================================================
echo.

REM ---- 1. Python ----
set "PY="
where py >nul 2>nul && (py -3.12 -c "print()" >nul 2>nul && set "PY=py -3.12")
if not defined PY (where py >nul 2>nul && (py -3 -c "import sys; assert sys.version_info>=(3,10)" >nul 2>nul && set "PY=py -3"))
if not defined PY (where python >nul 2>nul && (python -c "import sys; assert sys.version_info>=(3,10)" >nul 2>nul && set "PY=python"))
if not defined PY (
  echo [ERREUR] Python 3.10+ introuvable.
  echo Installe Python 3.12 depuis https://www.python.org/downloads/
  echo en cochant "Add python.exe to PATH", puis relance install.bat.
  pause & exit /b 1
)
echo [1/5] Python trouve : %PY%

REM ---- 2. Environnement Python ----
if not exist "backend\.venv\Scripts\python.exe" (
  echo [2/5] Creation de l'environnement Python...
  %PY% -m venv backend\.venv || (echo [ERREUR] venv impossible & pause & exit /b 1)
)
set "VPY=%~dp0backend\.venv\Scripts\python.exe"
echo [2/5] Installation des bibliotheques (quelques minutes)...
"%VPY%" -m pip install --upgrade pip >nul
"%VPY%" -m pip install -r backend\requirements.txt || (echo [ERREUR] pip a echoue & pause & exit /b 1)

REM ---- 3. Voix Piper francaises ----
echo [3/5] Telechargement des voix francaises Piper...
if not exist "backend\voices" mkdir "backend\voices"
set "HF=https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR"
call :voice siwis fr_FR-siwis-medium
call :voice tom fr_FR-tom-medium

REM ---- 4. Reconnaissance vocale Whisper ----
echo [4/5] Preparation de la reconnaissance vocale (Whisper small, ~480 Mo)...
"%VPY%" -c "import sys; sys.path.insert(0,'backend'); from cyberai.voice import stt; stt.preload(); print('    Whisper pret')"

REM ---- 5. Ollama + modeles ----
echo [5/5] Cerveau local (Ollama)...
where ollama >nul 2>nul
if errorlevel 1 (
  echo    Ollama n'est pas installe. Installation via winget...
  winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
  echo    Si winget a echoue : telecharge Ollama sur https://ollama.com/download puis relance install.bat
  set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Ollama"
)
where ollama >nul 2>nul && (
  echo    Telechargement du modele qwen3:8b ^(5 Go^)...
  ollama pull qwen3:8b
  echo    Telechargement du modele de memoire nomic-embed-text...
  ollama pull nomic-embed-text
)

REM ---- Raccourci bureau ----
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\CYBER AI.lnk'); $s.TargetPath='%~dp0CyberAI.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.IconLocation='%SystemRoot%\System32\shell32.dll,43'; $s.Save()"

echo.
echo  ==========================================================
echo     Installation terminee ! Raccourci "CYBER AI" sur le bureau.
echo  ==========================================================
pause
exit /b 0

:voice
if exist "backend\voices\%2.onnx" exit /b 0
echo    - voix %2
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest '%HF%/%1/medium/%2.onnx' -OutFile 'backend\voices\%2.onnx'; Invoke-WebRequest '%HF%/%1/medium/%2.onnx.json' -OutFile 'backend\voices\%2.onnx.json'"
exit /b 0
