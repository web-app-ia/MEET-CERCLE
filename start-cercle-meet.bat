@echo off
REM ============================================================
REM  CERCLE MEET - lanceur local
REM  Double-cliquez ce fichier pour demarrer l'application.
REM  Laisse la fenetre ouverte : la fermer arrete le serveur.
REM ============================================================

setlocal

set "PORT=3000"
set "NODE_EXE=C:\Users\Fouit\.workbuddy-ai\binaries\node\versions\22.22.2-1\node.exe"
set "APP_DIR=%~dp0app\mirotalk"

if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo.
echo   CERCLE MEET - demarrage sur http://localhost:%PORT%
echo.

REM ---- 1. Liberer le port s'il est deja occupe ----------------
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    echo   Un ancien serveur occupe le port %PORT% ^(PID %%P^) - arret...
    taskkill /PID %%P /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM ---- 2. Demarrer le moteur ----------------------------------
cd /d "%APP_DIR%"
if errorlevel 1 (
    echo   ERREUR : dossier introuvable : %APP_DIR%
    pause
    exit /b 1
)

echo   Demarrage du serveur...
start "" http://localhost:%PORT%

"%NODE_EXE%" app\src\server.js

echo.
echo   Le serveur s'est arrete.
pause
endlocal
