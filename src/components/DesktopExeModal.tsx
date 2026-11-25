import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  Laptop,
  Monitor,
  Terminal,
  X,
  Zap,
} from 'lucide-react';

interface DesktopExeModalProps {
  isOpen: boolean;
  isInstallable: boolean;
  isInstalled: boolean;
  isElectron: boolean;
  onInstallDesktop: () => Promise<boolean>;
  onClose: () => void;
}

const BUILD_BAT_CONTENT = `@echo off
setlocal
title GoViMix - Windows .EXE Builder
echo ======================================================
echo   GoViMix Studio DAW - Windows .EXE Builder (x64)
echo ======================================================
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js tidak ditemukan. Install Node.js LTS: https://nodejs.org
  pause
  exit /b 1
)
if not exist "package.json" (
  echo [ERROR] package.json tidak ditemukan di folder ini!
  echo Pastikan Anda mengekstrak ZIP project GoViMix terlebih dahulu,
  echo lalu jalankan file .bat ini di DALAM folder hasil ekstrak tersebut.
  pause
  exit /b 1
)
call npm install --legacy-peer-deps
if not exist "node_modules\\electron" call npm install --no-save --legacy-peer-deps electron electron-builder
call npm run build:exe
echo.
echo File .EXE selesai dibuat di folder release\\
start "" "%cd%\\release"
pause
`;

export const DesktopExeModal: React.FC<DesktopExeModalProps> = ({
  isOpen,
  isInstallable,
  isInstalled,
  isElectron,
  onInstallDesktop,
  onClose,
}) => {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (!isOpen) return null;

  const buildCommand = 'npm install --legacy-peer-deps && npm install --no-save --legacy-peer-deps electron electron-builder && npm run build:exe';

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(buildCommand);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handleDownloadBat = () => {
    const blob = new Blob([BUILD_BAT_CONTENT], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'build-windows-exe.bat';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleTriggerInstall = async () => {
    setInstalling(true);
    await onInstallDesktop();
    setInstalling(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl bg-[#0e121b] border border-cyan-500/40 shadow-[0_24px_64px_rgba(0,0,0,0.9)] overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#090c13] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center">
              <Monitor className="w-4 h-4 text-cyan-300" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                GoViMix PC Desktop &amp; Windows .EXE
              </h2>
              <p className="text-[11px] text-slate-400">
                Mode Standalone Windows PC &amp; Paket Installer Electron x64 (.exe)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[78vh] overflow-y-auto">
          {/* Option 1: Instant PC Desktop App */}
          <div className="rounded-lg bg-[#121826] border border-emerald-500/35 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Laptop className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  1. Install Langsung sebagai Aplikasi PC (Windows)
                </span>
              </div>
              {isElectron ? (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                  Berjalan di Desktop .EXE
                </span>
              ) : isInstalled ? (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                  Terinstall di PC
                </span>
              ) : (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">
                  Tanpa Browser Bar + Offline
                </span>
              )}
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Aplikasi GoViMix sudah dikonfigurasi sebagai aplikasi desktop Windows mandiri (PWA Standalone). Buka jendela aplikasi terpisah, pin ke Taskbar / Start Menu, dan jalankan secara offline.
            </p>

            {!isInstalled && (
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {isInstallable ? (
                  <button
                    type="button"
                    disabled={installing}
                    onClick={handleTriggerInstall}
                    className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-[0_0_16px_rgba(16,185,129,0.45)] transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {installing ? 'Menginstall...' : 'Install GoViMix ke PC Sekarang'}
                  </button>
                ) : (
                  <div className="w-full rounded bg-[#090d16] border border-white/10 p-2.5 text-[11px] text-slate-300 space-y-1">
                    <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                      <ExternalLink className="w-3.5 h-3.5" />
                      Cara Install di Windows (Chrome / Microsoft Edge):
                    </div>
                    <p>
                      1. Buka URL aplikasi di tab baru penuh (keluar dari iframe preview).
                    </p>
                    <p>
                      2. Klik ikon <strong className="text-white">Install GoViMix</strong> di sisi kanan address bar (atau menu <strong className="text-white">⋮ → Apps → Install GoViMix</strong>).
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Option 2: Electron Windows .EXE Build Package */}
          <div className="rounded-lg bg-[#121826] border border-cyan-500/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  2. Paket Build Windows .EXE (Electron x64)
                </span>
              </div>
              <span className="text-[10px] font-mono-tabular px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">
                NSIS Setup + Portable .exe
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Seluruh source desktop Electron, ikon Windows (<code className="text-cyan-300">.ico</code>), flag Low-Latency Web Audio, konfigurasi <code className="text-cyan-300">electron-builder.json</code>, serta workflow GitHub Actions (<code className="text-cyan-300">windows-latest</code>) sudah disiapkan di proyek ini untuk menghasilkan:
            </p>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded bg-[#090d16] border border-white/10 px-3 py-2 flex items-center justify-between">
                <span className="font-semibold text-white">GoViMix-Setup-1.0.0.exe</span>
                <span className="text-emerald-300 font-mono-tabular">Installer</span>
              </div>
              <div className="rounded bg-[#090d16] border border-white/10 px-3 py-2 flex items-center justify-between">
                <span className="font-semibold text-white">GoViMix-Portable-1.0.0.exe</span>
                <span className="text-cyan-300 font-mono-tabular">Portable</span>
              </div>
            </div>

            <div className="rounded bg-[#070a10] border border-white/10 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-[10.5px] text-slate-400">
                <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  Langkah Compile .EXE (Download &amp; Ekstrak ZIP Project dulu, lalu jalankan di dalam foldernya):
                </span>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="px-2 py-0.5 rounded bg-[#161e2e] hover:bg-[#1f2940] border border-white/10 text-cyan-300 flex items-center gap-1 transition-colors"
                >
                  {copiedCmd ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedCmd ? 'Tersalin' : 'Salin'}
                </button>
              </div>
              <code className="block text-[11px] font-mono-tabular text-emerald-300 break-all select-all">
                {buildCommand}
              </code>
              <p className="text-[10.5px] text-amber-300/90">
                Penting: Jangan jalankan di folder Downloads kosong — pastikan terminal berada di dalam folder hasil ekstrak ZIP yang memiliki file <code className="text-white">package.json</code>.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Mendukung auto-build via GitHub Actions atau klik 2x file .bat di Windows</span>
              </div>
              <button
                type="button"
                onClick={handleDownloadBat}
                className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download build-windows-exe.bat
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
