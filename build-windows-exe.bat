@echo off
setlocal
title GoViMix - Windows .EXE Builder
echo ======================================================
echo   GoViMix Studio DAW - Windows .EXE Builder (x64)
echo ======================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js tidak ditemukan. Silakan install Node.js LTS dari https://nodejs.org
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] File package.json tidak ditemukan di folder ini!
  echo.
  echo Cara yang benar:
  echo   1. Download / Export ZIP project GoViMix dari AI Studio.
  echo   2. Ekstrak file ZIP tersebut ke folder baru, misalnya C:\GoViMix
  echo   3. Jalankan build-windows-exe.bat dari DALAM folder hasil ekstrak itu.
  echo.
  pause
  exit /b 1
)

echo [1/4] Menginstall dependensi project...
call npm install --legacy-peer-deps
if errorlevel 1 goto :error

echo [2/4] Memastikan Electron dan Electron Builder terinstall...
if not exist "node_modules\electron" (
  call npm install --no-save --legacy-peer-deps electron electron-builder
  if errorlevel 1 goto :error
)

echo [3/4] Membangun aplikasi GoViMix...
call npm run build:electron
if errorlevel 1 goto :error

echo [4/4] Mengemas menjadi file Windows .EXE (Installer + Portable)...
call npx electron-builder --win --x64 --config electron-builder.json
if errorlevel 1 goto :error

echo.
echo ======================================================
echo   BERHASIL! File .EXE tersedia di folder "release\":
echo   - release\GoViMix-Setup-1.0.0.exe (Installer)
echo   - release\GoViMix-Portable-1.0.0.exe (Langsung Jalan)
echo ======================================================
start "" "%cd%\release"
pause
exit /b 0

:error
echo.
echo [GAGAL] Terjadi kesalahan saat proses build .EXE.
pause
exit /b 1
