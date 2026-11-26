import React, { useState } from 'react';
import {
  Activity,
  Cpu,
  Download,
  Monitor,
  Palette,
  Play,
  Square,
  Zap,
} from 'lucide-react';
import { AsioDriverConfig, ThemePreset } from '../types/mixer';

export interface CpuMonitorMetrics {
  cpuPercent: number;
  activePlugins: number;
  activeStreams: number;
  roundTripMs: number;
}

interface TopTransportBarProps {
  asioConfig: AsioDriverConfig;
  cpuMetrics: CpuMonitorMetrics;
  recordedAudioUrl: string | null;
  activeTheme: ThemePreset;
  isPlaying: boolean;
  onTogglePlayback: () => void;
  onOpenThemeModal: () => void;
  onOpenAsioModal: () => void;
  onOpenDesktopModal: () => void;
  isDesktopInstallable: boolean;
  isElectronDesktop: boolean;
}

export const TopTransportBar: React.FC<TopTransportBarProps> = ({
  asioConfig,
  cpuMetrics,
  recordedAudioUrl,
  activeTheme,
  isPlaying,
  onTogglePlayback,
  onOpenThemeModal,
  onOpenAsioModal,
  onOpenDesktopModal,
  isDesktopInstallable,
  isElectronDesktop,
}) => {
  const [showCpuDetails, setShowCpuDetails] = useState(false);
  const latencyMs = Number(((asioConfig.bufferSize / asioConfig.sampleRate) * 1000).toFixed(1));
  const cpuBarColor =
    cpuMetrics.cpuPercent >= 75
      ? '#ef4444'
      : cpuMetrics.cpuPercent >= 45
      ? '#f59e0b'
      : '#10b981';

  return (
    <header
      className="h-[46px] px-3 border-b border-[#1d2534] flex items-center justify-between gap-4 shrink-0 select-none"
      style={{ backgroundColor: 'var(--theme-bg-panel)' }}
    >
      {/* Left: Brand */}
      <div className="flex items-center shrink-0">
        <span className="text-sm font-bold tracking-wider text-white whitespace-nowrap">
          GoVi<span className="text-[var(--theme-neon)]">Mix</span>
        </span>
      </div>

      {/* Right: Play/Stop + Recorded Take Download + Theme Settings + PC / .EXE + Low Latency ASIO + CPU Monitor */}
      <div className="flex items-center gap-2 shrink-0 relative">
        <button
          type="button"
          onClick={onTogglePlayback}
          title={isPlaying ? 'Stop Demo / File Playback' : 'Play Demo Stem / Track'}
          className={`px-2.5 py-1.5 rounded border text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            isPlaying
              ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-400/60 text-emerald-300'
              : 'bg-[#121826] hover:bg-[#1a2234] border-[rgba(var(--theme-neon-rgb),0.45)] text-[var(--theme-neon-soft)]'
          }`}
        >
          {isPlaying ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
          <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>

        {recordedAudioUrl && (
          <a
            href={recordedAudioUrl}
            download="GoViMix_Recording.webm"
            className="px-2.5 py-1.5 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 text-[11px] font-semibold flex items-center gap-1.5 hover:bg-emerald-500/30 whitespace-nowrap transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Save Take
          </a>
        )}

        <button
          type="button"
          onClick={onOpenThemeModal}
          title={`Pengaturan Tema: ${activeTheme.name}`}
          className="px-2.5 py-1.5 rounded bg-[#121826] hover:bg-[#1a2234] border border-[rgba(var(--theme-neon-rgb),0.4)] text-[11px] font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap transition-all"
        >
          <Palette className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
          <span>Tema</span>
          <span
            className="w-2.5 h-2.5 rounded-full border border-white/30"
            style={{
              backgroundColor: activeTheme.neon,
              boxShadow: `0 0 6px ${activeTheme.neon}`,
            }}
          />
        </button>

        <button
          type="button"
          onClick={onOpenDesktopModal}
          title="Install GoViMix ke PC Windows atau Build .EXE"
          className={`px-2.5 py-1.5 rounded border text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            isDesktopInstallable
              ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-400/60 text-emerald-300'
              : 'bg-[#121826] hover:bg-[#1a2234] border-white/15 text-slate-200'
          }`}
        >
          <Monitor className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
          <span>{isElectronDesktop ? 'WIN .EXE' : 'PC / .EXE'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenAsioModal}
          title="Low Latency Priority Active · Click to configure ASIO & Audio/MIDI"
          className="px-2.5 py-1.5 rounded bg-[#121826] hover:bg-[#1a2234] border border-[rgba(var(--theme-neon-rgb),0.45)] text-xs flex items-center gap-1.5 whitespace-nowrap transition-all shadow-[0_0_12px_rgba(var(--theme-neon-rgb),0.14)]"
        >
          <Zap className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
          <span className="font-semibold text-[var(--theme-neon-soft)]">ASIO</span>
          <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-500/15 px-1 rounded">
            LOW LAT
          </span>
          <span className="font-mono-tabular text-[11px] text-slate-300">
            {(asioConfig.sampleRate / 1000).toFixed(1)}k / {asioConfig.bufferSize} ({latencyMs}ms)
          </span>
        </button>

        {/* CPU Monitor (Top-Right) */}
        <button
          type="button"
          onClick={() => setShowCpuDetails((v) => !v)}
          title="Audio DSP CPU Monitor"
          className="px-2.5 py-1.5 rounded bg-[#0c1018] hover:bg-[#141a26] border border-white/15 flex items-center gap-2 whitespace-nowrap transition-colors"
        >
          <Activity className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
          <span className="text-[10.5px] font-semibold text-slate-300">CPU</span>
          <div className="w-12 h-2 rounded-sm bg-[#1a202c] overflow-hidden border border-white/10">
            <div
              className="h-full transition-all duration-200"
              style={{
                width: `${cpuMetrics.cpuPercent}%`,
                backgroundColor: cpuBarColor,
              }}
            />
          </div>
          <span
            className="text-[11px] font-mono-tabular font-semibold min-w-[28px] text-right"
            style={{ color: cpuBarColor }}
          >
            {cpuMetrics.cpuPercent}%
          </span>
        </button>

        {showCpuDetails && (
          <div className="absolute right-0 top-[42px] z-50 w-64 rounded-md bg-[#0f141e] border border-[rgba(var(--theme-neon-rgb),0.45)] shadow-[0_16px_40px_rgba(0,0,0,0.85)] p-3 text-xs space-y-2">
            <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
                DSP &amp; CPU Monitor
              </span>
              <span className="text-[10px] font-semibold text-emerald-300">Low-Latency Mode</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <span className="text-slate-400">DSP Load</span>
              <span className="text-right font-mono-tabular font-semibold" style={{ color: cpuBarColor }}>
                {cpuMetrics.cpuPercent}%
              </span>
              <span className="text-slate-400">Round-Trip Latency</span>
              <span className="text-right font-mono-tabular text-[var(--theme-neon-soft)]">
                {cpuMetrics.roundTripMs} ms
              </span>
              <span className="text-slate-400">Active Inserts</span>
              <span className="text-right font-mono-tabular text-slate-200">
                {cpuMetrics.activePlugins} plugins
              </span>
              <span className="text-slate-400">Active Channels</span>
              <span className="text-right font-mono-tabular text-slate-200">
                {cpuMetrics.activeStreams} ch
              </span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
