import React, { useEffect, useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface MultibandDynamicsModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

const BAND_META = [
  { key: 'L', name: 'Low', color: '#3b82f6', neon: '#38bdf8', xoverKey: null },
  { key: 'LM', name: 'Low-Mid', color: '#f97316', neon: '#fb923c', xoverKey: 'x1' },
  { key: 'M', name: 'Mid', color: '#eab308', neon: '#fbbf24', xoverKey: 'x2' },
  { key: 'HM', name: 'High-Mid', color: '#84cc16', neon: '#a3e635', xoverKey: 'x3' },
  { key: 'H', name: 'High', color: '#10b981', neon: '#00f5a0', xoverKey: 'x4' },
] as const;

const XOVER_DEFAULTS = {
  x1: 65.1,
  x2: 241.9,
  x3: 1940,
  x4: 5980,
};

const XOVER_LIMITS: Record<string, { min: number; max: number }> = {
  x1: { min: 25, max: 180 },
  x2: { min: 150, max: 700 },
  x3: { min: 650, max: 4200 },
  x4: { min: 3500, max: 14000 },
};

function formatHz(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  return `${hz.toFixed(1)} Hz`;
}

function freqToNorm(freq: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.max(0, Math.min(1, (Math.log10(Math.max(20, freq)) - minLog) / (maxLog - minLog)));
}

function normToFreq(norm: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.pow(10, minLog + Math.max(0, Math.min(1, norm)) * (maxLog - minLog));
}

export const MultibandDynamicsModal: React.FC<MultibandDynamicsModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const [selectedBand, setSelectedBand] = useState<number>(0);
  const transferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingXoverRef = useRef<number | null>(null);

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  const x1 = getVal('x1', XOVER_DEFAULTS.x1);
  const x2 = getVal('x2', XOVER_DEFAULTS.x2);
  const x3 = getVal('x3', XOVER_DEFAULTS.x3);
  const x4 = getVal('x4', XOVER_DEFAULTS.x4);
  const xovers = [x1, x2, x3, x4];

  const autoSpeed = getVal('autoSpeed', 1) === 1;
  const sidechain = getVal('sidechain', 0) === 1;
  const editAllRelative = getVal('editAllRelative', 0) === 1;
  const metering = getVal('metering', 1) === 1;
  const knee = getVal('knee', 1.5);
  const globalGain = getVal('globalGain', 0.0);
  const mix = getVal('mix', 100);
  const rangeMin = getVal('rangeMin', -48);
  const rangeMax = getVal('rangeMax', 0);

  const bandLowThresh = getVal(`b${selectedBand}_lowThresh`, -12 - selectedBand * 2);
  const bandHighThresh = getVal(`b${selectedBand}_highThresh`, 0);
  const bandRatio = getVal(`b${selectedBand}_ratio`, 2.0);
  const bandGain = getVal(`b${selectedBand}_gain`, 0.0);
  const bandAttack = getVal(`b${selectedBand}_attack`, 12);
  const bandRelease = getVal(`b${selectedBand}_release`, 120);

  const setParam = (key: string, value: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => ({
      ...prev,
      params: { ...prev.params, [key]: value },
    }));
  };

  const setBandParam = (field: string, value: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => {
      const nextParams = { ...prev.params };
      if (editAllRelative) {
        const current = nextParams[`b${selectedBand}_${field}`] ?? (field === 'ratio' ? 2.0 : field === 'lowThresh' ? -12 - selectedBand * 2 : 0);
        const delta = value - current;
        for (let i = 0; i < 5; i++) {
          const base = nextParams[`b${i}_${field}`] ?? (field === 'ratio' ? 2.0 : field === 'lowThresh' ? -12 - i * 2 : 0);
          nextParams[`b${i}_${field}`] = Number((base + delta).toFixed(2));
        }
      } else {
        nextParams[`b${selectedBand}_${field}`] = value;
      }
      // Keep top-level compressor params synced for AudioEngine
      nextParams.threshold = nextParams[`b${selectedBand}_lowThresh`] ?? -16;
      nextParams.ratio = nextParams[`b${selectedBand}_ratio`] ?? 2.0;
      nextParams.attack = nextParams[`b${selectedBand}_attack`] ?? 12;
      nextParams.release = nextParams[`b${selectedBand}_release`] ?? 120;
      return { ...prev, params: nextParams };
    });
  };

  // Render Transfer Curve + Dual Stacked Multiband Spectrum/Dynamics Canvas
  useEffect(() => {
    let raf = 0;
    const render = () => {
      // 1. Left Transfer Curve Graph
      const tc = transferCanvasRef.current;
      if (tc) {
        const ctx = tc.getContext('2d');
        if (ctx) {
          const w = tc.width;
          const h = tc.height;
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#070a10';
          ctx.fillRect(0, 0, w, h);

          // Grid lines (-6, -12, -18, -24, -36)
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
          ctx.lineWidth = 1;
          for (let i = 1; i < 6; i++) {
            const x = (w / 6) * i;
            const y = (h / 6) * i;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }

          // Labels
          ctx.fillStyle = 'rgba(56, 189, 248, 0.65)';
          ctx.font = '10px JetBrains Mono, monospace';
          ['0', '-6', '-12', '-18', '-24', '-36'].forEach((lbl, idx) => {
            ctx.fillText(lbl, 4, 11 + idx * (h / 6));
          });
          ctx.fillText('-24', w * 0.46, h - 5);
          ctx.fillText('-12', w * 0.72, h - 5);

          // 1:1 Reference line
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(0, h);
          ctx.lineTo(w, 0);
          ctx.stroke();
          ctx.setLineDash([]);

          // Active Band Transfer Curve
          const bandColor = BAND_META[selectedBand].neon;
          ctx.beginPath();
          ctx.strokeStyle = plugin.enabled ? bandColor : '#64748b';
          ctx.lineWidth = 2.2;
          ctx.shadowColor = plugin.enabled ? bandColor : 'transparent';
          ctx.shadowBlur = plugin.enabled ? 8 : 0;

          const minDb = -42;
          for (let px = 0; px <= w; px += 2) {
            const inDb = minDb + (px / w) * (0 - minDb);
            let outDb = inDb;
            if (inDb > bandLowThresh) {
              outDb = bandLowThresh + (inDb - bandLowThresh) / Math.max(1, bandRatio);
            }
            outDb += bandGain * 0.5;
            const y = h - ((outDb - minDb) / (0 - minDb)) * h;
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Knee / Threshold node dot
          const kx = ((bandLowThresh - minDb) / (0 - minDb)) * w;
          const ky = h - ((bandLowThresh + bandGain * 0.5 - minDb) / (0 - minDb)) * h;
          ctx.beginPath();
          ctx.arc(kx, ky, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = '#070a10';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = bandColor;
          ctx.stroke();
        }
      }

      // 2. Right Dual Stacked Spectrum + Band Input/Output Canvas
      const sc = spectrumCanvasRef.current;
      if (sc) {
        const ctx = sc.getContext('2d');
        if (ctx) {
          const w = sc.width;
          const h = sc.height;
          const midY = h / 2;
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#070a10';
          ctx.fillRect(0, 0, w, h);

          // Grid lines
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
          ctx.lineWidth = 1;
          [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => {
            const fx = freqToNorm(f) * w;
            ctx.beginPath();
            ctx.moveTo(fx, 0);
            ctx.lineTo(fx, h);
            ctx.stroke();
          });

          // Horizontal divider between Input (top) & Output (bottom)
          ctx.fillStyle = '#121824';
          ctx.fillRect(0, midY - 2, w, 4);

          const fft = audioEngine.getMasterSpectrum();
          const bounds = [20, x1, x2, x3, x4, 20000];

          for (let b = 0; b < 5; b++) {
            const xStart = freqToNorm(bounds[b]) * w;
            const xEnd = freqToNorm(bounds[b + 1]) * w;
            const bw = Math.max(2, xEnd - xStart);

            const lowT = getVal(`b${b}_lowThresh`, -12 - b * 2);
            const highT = getVal(`b${b}_highThresh`, 0);
            const ratio = getVal(`b${b}_ratio`, 2.0);
            const bGain = getVal(`b${b}_gain`, 0);
            const bypassed = getVal(`b${b}_bypass`, 0) === 1;
            const muted = getVal(`b${b}_mute`, 0) === 1;

            // Selected band subtle highlight
            if (b === selectedBand) {
              ctx.fillStyle = `${BAND_META[b].neon}12`;
              ctx.fillRect(xStart, 0, bw, h);
            }

            // Threshold box in Input section (top half)
            const topTNorm = Math.max(0, Math.min(1, (highT - rangeMin) / (rangeMax - rangeMin)));
            const botTNorm = Math.max(0, Math.min(1, (lowT - rangeMin) / (rangeMax - rangeMin)));
            const boxTop = (1 - topTNorm) * (midY - 6);
            const boxBot = (1 - botTNorm) * (midY - 6);

            ctx.fillStyle = muted ? 'rgba(100,116,139,0.08)' : 'rgba(56, 189, 248, 0.14)';
            ctx.fillRect(xStart + 1, boxTop, bw - 2, Math.max(4, boxBot - boxTop));
            ctx.strokeStyle = BAND_META[b].neon;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(xStart + 1, boxBot);
            ctx.lineTo(xEnd - 1, boxBot);
            ctx.stroke();

            // Sample FFT energy for this frequency band
            let sum = 0;
            let count = 0;
            const nyquist = 24000;
            for (let k = 0; k < fft.length; k++) {
              const binFreq = (k / fft.length) * nyquist;
              if (binFreq >= bounds[b] && binFreq <= bounds[b + 1]) {
                sum += fft[k];
                count++;
              }
            }
            const avgNorm = metering && count > 0 ? sum / count / 255 : 0;
            const inDb = -60 + avgNorm * 60;
            const inNorm = Math.max(0, Math.min(1, (inDb - rangeMin) / (rangeMax - rangeMin)));

            // Live Input level bar (Top half)
            if (metering && avgNorm > 0.01 && !muted) {
              const barH = inNorm * (midY - 8);
              ctx.fillStyle = `${BAND_META[b].neon}55`;
              ctx.fillRect(xStart + 2, midY - 3 - barH, bw - 4, barH);
              ctx.fillStyle = BAND_META[b].neon;
              ctx.fillRect(xStart + 2, midY - 4 - barH, bw - 4, 2);
            }

            // Compute Gain Reduction for Output section (Bottom half)
            let grDb = 0;
            if (!bypassed && !muted && plugin.enabled && inDb > lowT) {
              grDb = (inDb - lowT) * (1 - 1 / Math.max(1, ratio));
            }
            const outDb = inDb - grDb + bGain;
            const outNorm = Math.max(0, Math.min(1, (outDb - rangeMin) / (rangeMax - rangeMin)));

            // Output Threshold / Reduction window (Bottom half)
            const outBoxTop = midY + 4 + (1 - topTNorm) * (h - midY - 8);
            const outBoxBot = midY + 4 + (1 - botTNorm) * (h - midY - 8);
            ctx.fillStyle = 'rgba(244, 63, 94, 0.12)';
            ctx.fillRect(xStart + 1, outBoxTop, bw - 2, Math.max(4, outBoxBot - outBoxTop));

            if (metering && avgNorm > 0.01 && !muted) {
              const outH = outNorm * (h - midY - 8);
              ctx.fillStyle = `${BAND_META[b].neon}44`;
              ctx.fillRect(xStart + 2, h - outH, bw - 4, outH);

              // Gain Reduction drop-down indicator
              if (grDb > 0.2) {
                const grPx = Math.min(h - midY - 12, (grDb / 24) * (h - midY - 12));
                ctx.fillStyle = 'rgba(255, 59, 92, 0.65)';
                ctx.fillRect(xStart + 2, midY + 4, bw - 4, grPx);
              }
            }
          }

          // Frequency labels along divider
          ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
          ctx.font = '9.5px JetBrains Mono, monospace';
          [
            { f: 50, l: '50' },
            { f: 100, l: '100' },
            { f: 200, l: '200' },
            { f: 500, l: '500' },
            { f: 1000, l: '1 k' },
            { f: 2000, l: '2 k' },
            { f: 5000, l: '5 k' },
            { f: 10000, l: '10 k' },
          ].forEach((item) => {
            const x = freqToNorm(item.f) * w;
            ctx.fillText(item.l, x + 2, midY - 6);
          });

          // 4 Colored Draggable Crossover Lines
          xovers.forEach((xf, idx) => {
            const x = freqToNorm(xf) * w;
            const col = BAND_META[idx + 1].neon;
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.6;
            ctx.shadowColor = col;
            ctx.shadowBlur = 5;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            ctx.shadowBlur = 0;
          });
        }
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [
    bandGain,
    bandHighThresh,
    bandLowThresh,
    bandRatio,
    metering,
    p,
    plugin.enabled,
    rangeMax,
    rangeMin,
    selectedBand,
    x1,
    x2,
    x3,
    x4,
  ]);

  const handleSpectrumPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / rect.width;
    let closestIdx: number | null = null;
    let minDist = 0.035;
    xovers.forEach((xf, idx) => {
      const d = Math.abs(freqToNorm(xf) - normX);
      if (d < minDist) {
        minDist = d;
        closestIdx = idx;
      }
    });
    if (closestIdx !== null) {
      draggingXoverRef.current = closestIdx;
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      // Click selects the clicked frequency band
      const freq = normToFreq(normX);
      const bounds = [20, x1, x2, x3, x4, 20000];
      for (let b = 0; b < 5; b++) {
        if (freq >= bounds[b] && freq <= bounds[b + 1]) {
          setSelectedBand(b);
          break;
        }
      }
    }
  };

  const handleSpectrumPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingXoverRef.current === null) return;
    const idx = draggingXoverRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const normX = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    const freq = normToFreq(normX);
    const key = `x${idx + 1}`;
    const lim = XOVER_LIMITS[key];
    const clamped = Math.max(lim.min, Math.min(lim.max, freq));
    setParam(key, Number(clamped.toFixed(1)));
  };

  const handleSpectrumPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingXoverRef.current !== null) {
      draggingXoverRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const activeMeta = BAND_META[selectedBand];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[920px] rounded-xl bg-[#0d111a] border border-cyan-500/40 shadow-[0_28px_100px_rgba(0,0,0,0.92)] overflow-hidden select-none"
      >
        {/* Top Plugin Window Toolbar */}
        <div className="h-9 px-3 bg-[#141925] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1 rounded border transition-all ${
                plugin.enabled
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/60 shadow-[0_0_8px_rgba(34,211,238,0.45)]'
                  : 'bg-[#1b2230] text-slate-500 border-white/10'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-semibold text-cyan-300 font-mono-tabular">
              {plugin.format}
            </span>
            <span className="text-xs font-semibold text-white">{plugin.name}</span>
            <span className="text-[11px] text-slate-400">
              · {channel.name || `Ch ${channel.index}`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setParam('sidechain', sidechain ? 0 : 1)}
              className={`px-2.5 py-0.5 rounded text-[11px] font-medium border transition-all ${
                sidechain
                  ? 'bg-amber-500/25 text-amber-300 border-amber-400/60'
                  : 'bg-[#1a202d] text-slate-400 border-white/10 hover:text-slate-200'
              }`}
            >
              Sidechain
            </button>
            <button
              type="button"
              onClick={() => setParam('editAllRelative', editAllRelative ? 0 : 1)}
              className={`px-2.5 py-0.5 rounded text-[11px] font-medium border transition-all ${
                editAllRelative
                  ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400/60'
                  : 'bg-[#1a202d] text-slate-400 border-white/10 hover:text-slate-200'
              }`}
            >
              Edit All Relative
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-header */}
        <div className="px-4 py-1.5 bg-[#10141f] border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-100">Multiband Dynamics</span>
            <span className="text-xs text-slate-400">
              Band:{' '}
              <strong style={{ color: activeMeta.neon }}>{activeMeta.name}</strong>
            </span>
          </div>
          <span className="text-[11px] font-mono-tabular text-slate-400">
            5-Band Crossover &amp; Dynamic Compressor
          </span>
        </div>

        {/* Upper Graphs Row */}
        <div className="p-3 pb-2 bg-[#0a0d14] grid grid-cols-12 gap-2.5">
          {/* Left: Transfer Curve */}
          <div className="col-span-4 flex flex-col gap-1.5">
            <div className="rounded border border-white/10 overflow-hidden bg-[#070a10] h-[206px]">
              <canvas
                ref={transferCanvasRef}
                width={280}
                height={206}
                className="w-full h-full block"
              />
            </div>
            <div className="flex items-center justify-between gap-1.5 text-[10.5px]">
              <select
                value={rangeMin}
                onChange={(e) => setParam('rangeMin', Number(e.target.value))}
                className="px-1.5 py-0.5 rounded bg-[#141a26] border border-cyan-500/35 text-cyan-300 font-mono-tabular outline-none"
              >
                <option value={-60}>-60dB</option>
                <option value={-48}>-48dB</option>
                <option value={-36}>-36dB</option>
              </select>
              <span className="text-slate-400">Level Range</span>
              <select
                value={rangeMax}
                onChange={(e) => setParam('rangeMax', Number(e.target.value))}
                className="px-1.5 py-0.5 rounded bg-[#141a26] border border-cyan-500/35 text-cyan-300 font-mono-tabular outline-none"
              >
                <option value={0}>0dB</option>
                <option value={6}>+6dB</option>
              </select>
            </div>
          </div>

          {/* Right: Dual Input / Output Band Display */}
          <div className="col-span-8 flex flex-col gap-1.5">
            <div className="relative rounded border border-white/10 overflow-hidden bg-[#070a10] h-[206px] flex">
              <div className="w-4 flex flex-col justify-around items-center bg-[#0b0f18] border-r border-white/10 text-[9px] text-slate-400">
                <span className="-rotate-90 whitespace-nowrap">Input</span>
                <span className="-rotate-90 whitespace-nowrap">Output</span>
              </div>
              <canvas
                ref={spectrumCanvasRef}
                width={560}
                height={206}
                onPointerDown={handleSpectrumPointerDown}
                onPointerMove={handleSpectrumPointerMove}
                onPointerUp={handleSpectrumPointerUp}
                className="flex-1 h-full block cursor-ew-resize"
              />
              <div className="w-7 bg-[#0b0f18] border-l border-white/10 flex flex-col justify-between py-1 px-1 text-[8.5px] font-mono-tabular text-slate-400 text-right">
                <span>6</span>
                <span className="text-cyan-400">0</span>
                <span>-12</span>
                <span>-24</span>
                <span>-36</span>
                <span>-48</span>
                <span>-60</span>
              </div>
            </div>

            {/* Crossover Hz Readouts + Metering Toggle */}
            <div className="flex items-center justify-between px-2">
              <div className="flex-1 grid grid-cols-4 text-center text-[11px] font-mono-tabular font-semibold">
                <span style={{ color: BAND_META[1].neon }}>{formatHz(x1)}</span>
                <span style={{ color: BAND_META[2].neon }}>{formatHz(x2)}</span>
                <span style={{ color: BAND_META[3].neon }}>{formatHz(x3)}</span>
                <span style={{ color: BAND_META[4].neon }}>{formatHz(x4)}</span>
              </div>
              <button
                type="button"
                onClick={() => setParam('metering', metering ? 0 : 1)}
                className={`px-3 py-0.5 rounded text-[10.5px] font-semibold border transition-all ${
                  metering
                    ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_10px_rgba(0,229,255,0.45)]'
                    : 'bg-[#141a26] text-slate-400 border-white/10'
                }`}
              >
                Metering
              </button>
            </div>
          </div>
        </div>

        {/* Middle Setup Section (5 Band Selectors & Crossovers) */}
        <div className="mx-3 mb-2.5 p-2.5 rounded-lg bg-[#121722] border border-white/10">
          <div className="text-[11px] font-semibold text-slate-300 mb-2">Setup</div>
          <div className="grid grid-cols-5 gap-3">
            {BAND_META.map((band, idx) => {
              const active = selectedBand === idx;
              const isBypassed = getVal(`b${idx}_bypass`, 0) === 1;
              const isMuted = getVal(`b${idx}_mute`, 0) === 1;
              const isSolo = getVal(`b${idx}_solo`, 0) === 1;
              const xKey = band.xoverKey;
              const xVal = xKey ? getVal(xKey, XOVER_DEFAULTS[xKey]) : null;
              const lim = xKey ? XOVER_LIMITS[xKey] : null;

              return (
                <div
                  key={band.key}
                  onClick={() => setSelectedBand(idx)}
                  className={`flex items-center gap-2 p-1.5 rounded-md border cursor-pointer transition-all ${
                    active
                      ? 'bg-[#182132] border-cyan-400/60 shadow-[0_0_12px_rgba(0,229,255,0.16)]'
                      : 'bg-[#0d111a] border-white/5 hover:border-white/20'
                  }`}
                >
                  {xKey && xVal !== null && lim ? (
                    <RotaryKnob
                      value={xVal}
                      min={lim.min}
                      max={lim.max}
                      defaultValue={XOVER_DEFAULTS[xKey]}
                      size={34}
                      neonColor={band.neon}
                      label={`${band.name} Crossover`}
                      onChange={(v) => setParam(xKey, v)}
                    />
                  ) : (
                    <div
                      className="w-[34px] h-[34px] rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{
                        borderColor: `${band.neon}88`,
                        color: band.neon,
                        backgroundColor: `${band.neon}18`,
                      }}
                    >
                      20Hz
                    </div>
                  )}

                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedBand(idx);
                      }}
                      className={`h-5 rounded-[3px] text-[10.5px] font-bold border transition-all ${
                        active
                          ? 'text-slate-950 border-white/40'
                          : 'bg-[#171d2b] text-slate-300 border-white/10'
                      }`}
                      style={
                        active
                          ? { backgroundColor: band.neon, boxShadow: `0 0 10px ${band.neon}66` }
                          : undefined
                      }
                    >
                      {band.key}
                    </button>
                    <div className="grid grid-cols-3 gap-0.5">
                      <button
                        type="button"
                        title="Bypass Band"
                        onClick={(e) => {
                          e.stopPropagation();
                          setParam(`b${idx}_bypass`, isBypassed ? 0 : 1);
                        }}
                        className={`h-4 rounded-[2px] text-[8.5px] font-bold border ${
                          !isBypassed
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : 'bg-[#10141d] text-slate-500 border-white/10'
                        }`}
                      >
                        In
                      </button>
                      <button
                        type="button"
                        title="Mute Band"
                        onClick={(e) => {
                          e.stopPropagation();
                          setParam(`b${idx}_mute`, isMuted ? 0 : 1);
                        }}
                        className={`h-4 rounded-[2px] text-[8.5px] font-bold border ${
                          isMuted
                            ? 'bg-rose-600 text-white border-rose-400'
                            : 'bg-[#10141d] text-slate-400 border-white/10'
                        }`}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        title="Solo Band"
                        onClick={(e) => {
                          e.stopPropagation();
                          setParam(`b${idx}_solo`, isSolo ? 0 : 1);
                        }}
                        className={`h-4 rounded-[2px] text-[8.5px] font-bold border ${
                          isSolo
                            ? 'bg-amber-400 text-slate-950 border-amber-200'
                            : 'bg-[#10141d] text-slate-400 border-white/10'
                        }`}
                      >
                        S
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Panels: Selected Band Dynamics + Global */}
        <div className="px-3 pb-3 grid grid-cols-12 gap-2.5 bg-[#0a0d14]">
          {/* Left: Active Band Controls */}
          <div className="col-span-7 p-3 rounded-lg bg-[#121722] border border-white/10">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-slate-200">
                <span style={{ color: activeMeta.neon }}>{activeMeta.key}</span>-Band Dynamics
              </span>
              <span className="text-[10px] font-mono-tabular text-slate-400">
                {activeMeta.name}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-2">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400 text-center leading-tight">
                  Low Thresh
                </span>
                <RotaryKnob
                  value={bandLowThresh}
                  min={-48}
                  max={0}
                  defaultValue={-12}
                  size={38}
                  neonColor="#ff3b5c"
                  label="Low Threshold"
                  onChange={(v) => setBandParam('lowThresh', v)}
                />
                <span className="text-[10.5px] font-mono-tabular text-slate-200">
                  {bandLowThresh.toFixed(2)}
                </span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400 text-center leading-tight">
                  High Thresh
                </span>
                <RotaryKnob
                  value={bandHighThresh}
                  min={-24}
                  max={6}
                  defaultValue={0}
                  size={38}
                  neonColor="#ff3b5c"
                  label="High Threshold"
                  onChange={(v) => setBandParam('highThresh', v)}
                />
                <span className="text-[10.5px] font-mono-tabular text-slate-200">
                  {bandHighThresh.toFixed(2)}
                </span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400 text-center leading-tight">Ratio</span>
                <RotaryKnob
                  value={bandRatio}
                  min={1}
                  max={16}
                  defaultValue={2.0}
                  size={44}
                  neonColor="#ff3b5c"
                  label="Ratio"
                  onChange={(v) => setBandParam('ratio', v)}
                />
                <span className="text-[10.5px] font-mono-tabular text-slate-200">
                  {bandRatio.toFixed(1)} : 1
                </span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400 text-center leading-tight">Gain</span>
                <RotaryKnob
                  value={bandGain}
                  min={-12}
                  max={12}
                  defaultValue={0}
                  size={44}
                  neonColor={activeMeta.neon}
                  label="Band Gain"
                  onChange={(v) => setBandParam('gain', v)}
                />
                <span className="text-[10.5px] font-mono-tabular text-slate-200">
                  {bandGain.toFixed(2)} dB
                </span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400 text-center leading-tight">Attack</span>
                <RotaryKnob
                  value={bandAttack}
                  min={1}
                  max={100}
                  defaultValue={12}
                  size={34}
                  neonColor={autoSpeed ? '#475569' : '#00e5ff'}
                  label="Attack"
                  onChange={(v) => setBandParam('attack', v)}
                />
                <span className="text-[10px] font-mono-tabular text-slate-400">
                  {autoSpeed ? 'Auto' : `${bandAttack.toFixed(0)} ms`}
                </span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400 text-center leading-tight">
                  Release
                </span>
                <RotaryKnob
                  value={bandRelease}
                  min={10}
                  max={500}
                  defaultValue={120}
                  size={34}
                  neonColor={autoSpeed ? '#475569' : '#00e5ff'}
                  label="Release"
                  onChange={(v) => setBandParam('release', v)}
                />
                <span className="text-[10px] font-mono-tabular text-slate-400">
                  {autoSpeed ? 'Auto' : `${bandRelease.toFixed(0)} ms`}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Global Controls */}
          <div className="col-span-5 p-3 rounded-lg bg-[#121722] border border-white/10">
            <div className="text-xs font-semibold text-slate-200 mb-2.5">Global</div>
            <div className="grid grid-cols-4 gap-2 items-center">
              <div className="flex flex-col items-center justify-center">
                <button
                  type="button"
                  onClick={() => setParam('autoSpeed', autoSpeed ? 0 : 1)}
                  className={`px-3 py-2.5 rounded-md text-[11px] font-bold leading-tight border transition-all ${
                    autoSpeed
                      ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_14px_rgba(0,229,255,0.45)]'
                      : 'bg-[#171e2c] text-slate-400 border-white/10 hover:text-white'
                  }`}
                >
                  Auto
                  <br />
                  Speed
                </button>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400">Knee</span>
                <RotaryKnob
                  value={knee}
                  min={0}
                  max={12}
                  defaultValue={1.5}
                  size={36}
                  neonColor="#fbbf24"
                  label="Knee"
                  onChange={(v) => setParam('knee', v)}
                />
                <span className="text-[10.5px] font-mono-tabular text-slate-200">
                  {knee.toFixed(2)} dB
                </span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400">Gain</span>
                <RotaryKnob
                  value={globalGain}
                  min={-12}
                  max={12}
                  defaultValue={0}
                  size={44}
                  neonColor="#00e5ff"
                  label="Global Gain"
                  onChange={(v) => setParam('globalGain', v)}
                />
                <span className="text-[10.5px] font-mono-tabular text-slate-200">
                  {globalGain.toFixed(2)} dB
                </span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400">Mix</span>
                <RotaryKnob
                  value={mix}
                  min={0}
                  max={100}
                  defaultValue={100}
                  size={44}
                  neonColor="#fbbf24"
                  label="Mix"
                  onChange={(v) => setParam('mix', v)}
                />
                <span className="text-[10.5px] font-mono-tabular text-slate-200">
                  {mix.toFixed(0)} %
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
