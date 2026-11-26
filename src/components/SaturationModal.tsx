import React, { useEffect, useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface SaturationModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

const SAT_MODES = [
  { id: 0, label: 'Tube', desc: 'Warm 2nd-order triode' },
  { id: 1, label: 'Tape', desc: 'Smooth magnetic hysteresis' },
  { id: 2, label: 'Crunch', desc: 'Crisp odd-harmonic drive' },
  { id: 3, label: 'Diode', desc: 'Asymmetric hard clip' },
] as const;

function shapePreview(
  x: number,
  mode: number,
  driveGain: number,
  bias: number,
  evenAmt: number
): number {
  const xb = x * driveGain + bias;
  let y = 0;
  if (mode === 0) {
    const t = Math.tanh(xb) - Math.tanh(bias);
    const norm = 1 / Math.max(0.4, Math.tanh(driveGain));
    y = t * norm + evenAmt * (x * x * driveGain * 0.28);
  } else if (mode === 1) {
    const norm = 1 / Math.max(0.4, Math.tanh(driveGain * 0.9));
    y = (Math.tanh(xb * 0.9) - Math.tanh(bias * 0.9)) * norm;
  } else if (mode === 2) {
    const k = driveGain * 1.45;
    y = (2 / Math.PI) * Math.atan(x * k + bias * 0.8) + evenAmt * 0.15 * x * x;
  } else {
    const pos = xb >= 0 ? Math.tanh(xb * 1.55) : Math.max(-0.88, Math.min(0.88, xb * 1.9));
    y = pos - Math.tanh(bias * 0.6);
  }
  return Math.max(-1.1, Math.min(1.1, y));
}

export const SaturationModal: React.FC<SaturationModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastTelemetryRef = useRef({ driveDb: 0, satAmount: 0, inRmsDb: -60, outRmsDb: -60 });
  const [telemetry, setTelemetry] = useState({ driveDb: 0, satAmount: 0, inRmsDb: -60, outRmsDb: -60 });

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  const mode = Math.round(getVal('mode', 0));
  const drive = getVal('drive', 32);
  const harmonics = getVal('harmonics', 38);
  const lowCut = getVal('lowCut', 85);
  const tone = getVal('tone', 7200);
  const outputDb = getVal('outputDb', 0);
  const autoGain = getVal('autoGain', 1) === 1;
  const mix = getVal('mix', 75);

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => ({
      ...prev,
      params: { ...prev.params, [key]: val },
    }));
  };

  useEffect(() => {
    let raf = 0;
    const render = () => {
      const m = plugin.enabled
        ? audioEngine.getChannelSaturationMetrics(channel.id)
        : { driveDb: 0, satAmount: 0, inRmsDb: -60, outRmsDb: -60 };

      if (
        Math.abs(m.driveDb - lastTelemetryRef.current.driveDb) >= 0.15 ||
        Math.abs(m.outRmsDb - lastTelemetryRef.current.outRmsDb) >= 0.4
      ) {
        lastTelemetryRef.current = m;
        setTelemetry(m);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          ctx.fillStyle = '#070a0f';
          ctx.fillRect(0, 0, w, h);

          const padL = 32;
          const padR = 16;
          const padT = 14;
          const padB = 22;
          const gw = w - padL - padR;
          const gh = h - padT - padB;
          const midY = padT + gh / 2;

          // Studio Grid
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
          ctx.lineWidth = 1;
          for (let gx = 0; gx <= 4; gx++) {
            const x = padL + (gx / 4) * gw;
            ctx.beginPath();
            ctx.moveTo(x, padT);
            ctx.lineTo(x, padT + gh);
            ctx.stroke();
          }
          for (let gy = 0; gy <= 4; gy++) {
            const y = padT + (gy / 4) * gh;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + gw, y);
            ctx.stroke();
          }

          // Center axes
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
          ctx.beginPath();
          ctx.moveTo(padL, midY);
          ctx.lineTo(padL + gw, midY);
          ctx.moveTo(padL + gw / 2, padT);
          ctx.lineTo(padL + gw / 2, padT + gh);
          ctx.stroke();

          // Linear 1:1 reference
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.28)';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(padL, padT + gh);
          ctx.lineTo(padL + gw, padT);
          ctx.stroke();
          ctx.setLineDash([]);

          // Live Transfer Curve (x in -1..1 -> y in -1..1)
          const driveNorm = drive / 100;
          const driveGain = 1 + driveNorm * 10.5;
          const harmNorm = harmonics / 100;
          const bias = harmNorm * 0.28;
          const evenAmt = Math.max(0, -harmNorm) * 0.5 + (mode === 0 ? 0.18 : 0);
          const wetMix = mix / 100;

          // Subtle harmonic glow fill under transfer curve
          ctx.beginPath();
          for (let i = 0; i <= 140; i++) {
            const xNorm = (i / 140) * 2 - 1;
            const shaped = shapePreview(xNorm, mode, driveGain, bias, evenAmt);
            const yNorm = xNorm * (1 - wetMix) + shaped * wetMix;
            const px = padL + (i / 140) * gw;
            const py = midY - Math.max(-1, Math.min(1, yNorm)) * (gh * 0.46);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }

          ctx.strokeStyle = plugin.enabled ? channel.neonAccent : '#64748b';
          ctx.lineWidth = 2.5;
          ctx.shadowColor = plugin.enabled ? channel.neonAccent : 'transparent';
          ctx.shadowBlur = plugin.enabled ? 10 : 0;
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Live audio signal excursion dot along transfer curve
          if (plugin.enabled && m.inRmsDb > -56) {
            const amp = Math.min(0.95, Math.pow(10, m.inRmsDb / 20) * 2.2);
            const shapedPos = shapePreview(amp, mode, driveGain, bias, evenAmt);
            const yPos = amp * (1 - wetMix) + shapedPos * wetMix;
            const dotX = padL + ((amp + 1) / 2) * gw;
            const dotY = midY - Math.max(-1, Math.min(1, yPos)) * (gh * 0.46);
            ctx.beginPath();
            ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = channel.neonAccent;
            ctx.fill();
          }

          // Labels
          ctx.fillStyle = '#94a3b8';
          ctx.font = '10px ui-monospace, monospace';
          ctx.textAlign = 'right';
          ctx.fillText('+1', padL - 5, padT + 8);
          ctx.fillText('0', padL - 5, midY + 3);
          ctx.fillText('-1', padL - 5, padT + gh);
          ctx.textAlign = 'center';
          ctx.fillText('-1.0', padL + 12, h - 6);
          ctx.fillText('Transfer Curve (2x Oversampled)', padL + gw / 2, h - 6);
          ctx.fillText('+1.0', padL + gw - 12, h - 6);
        }
      }

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [channel.id, channel.neonAccent, drive, harmonics, mix, mode, plugin.enabled]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[660px] rounded-lg bg-[#0d1119] border border-[rgba(var(--theme-neon-rgb),0.45)] shadow-[0_24px_80px_rgba(0,0,0,0.88)] overflow-hidden select-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#121824] border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1.5 rounded border transition-all ${
                plugin.enabled
                  ? 'bg-[rgba(var(--theme-neon-rgb),0.2)] text-[var(--theme-neon-soft)] border-[rgba(var(--theme-neon-rgb),0.65)] shadow-[0_0_10px_rgba(var(--theme-neon-rgb),0.35)]'
                  : 'bg-[#1a202d] text-slate-500 border-white/10'
              }`}
            >
              <Power className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white leading-tight">
                <span>{plugin.name} · Harmonic Exciter</span>
                <span className="text-[10px] font-mono tabular-nums text-[var(--theme-neon-soft)]">
                  {plugin.format ?? 'VST3'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                {plugin.vendor ?? 'Studio DSP'} · {SAT_MODES[mode]?.desc} ·{' '}
                <span style={{ color: channel.neonAccent }}>
                  {channel.name || `Ch ${channel.index}`}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="px-4 pt-3 flex items-center justify-between gap-2">
          <div className="grid grid-cols-4 gap-1.5 flex-1">
            {SAT_MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setParam('mode', m.id)}
                  className={`py-1.5 px-2 rounded text-[11px] font-semibold border transition-all whitespace-nowrap ${
                    active
                      ? 'bg-[rgba(var(--theme-neon-rgb),0.2)] text-[var(--theme-neon-soft)] border-[rgba(var(--theme-neon-rgb),0.7)]'
                      : 'bg-[#121824] text-slate-400 border-white/10 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setParam('autoGain', autoGain ? 0 : 1)}
            className={`px-3 py-1.5 rounded text-[11px] font-semibold border transition-all whitespace-nowrap ${
              autoGain
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/60'
                : 'bg-[#121824] text-slate-400 border-white/10 hover:text-white'
            }`}
          >
            Auto Gain: {autoGain ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Transfer Curve + Live Harmonic Saturation Meter */}
        <div className="p-4 grid grid-cols-[1fr_118px] gap-3">
          <div className="rounded border border-white/10 bg-[#070a0f] overflow-hidden">
            <canvas ref={canvasRef} width={490} height={190} className="w-full h-[190px] block" />
          </div>

          <div className="rounded border border-white/10 bg-[#090d14] p-2.5 flex flex-col justify-between text-[10.5px]">
            <div className="text-slate-400 font-medium text-center">Harmonics</div>
            <div className="flex-1 flex items-end justify-center gap-2.5 py-2">
              {/* Drive Saturation Meter */}
              <div className="flex flex-col items-center gap-1 h-full justify-end">
                <div className="w-4 h-[108px] rounded-sm bg-[#121722] border border-white/10 p-0.5 flex flex-col justify-end overflow-hidden">
                  <div
                    className="w-full rounded-[1px] transition-all duration-75"
                    style={{
                      height: `${Math.min(100, telemetry.satAmount * 100)}%`,
                      background: 'linear-gradient(to top, #10b981 0%, #f59e0b 65%, #ef4444 100%)',
                    }}
                  />
                </div>
                <span className="text-[9px] text-slate-400">Sat</span>
              </div>

              {/* Output Level Meter */}
              <div className="flex flex-col items-center gap-1 h-full justify-end">
                <div className="w-4 h-[108px] rounded-sm bg-[#121722] border border-white/10 p-0.5 flex flex-col justify-end overflow-hidden">
                  <div
                    className="w-full rounded-[1px] transition-all duration-75"
                    style={{
                      height: `${Math.max(0, Math.min(100, ((telemetry.outRmsDb + 60) / 60) * 100))}%`,
                      backgroundColor: channel.neonAccent,
                    }}
                  />
                </div>
                <span className="text-[9px] text-slate-400">Out</span>
              </div>
            </div>
            <div className="space-y-0.5 font-mono tabular-nums text-[10px] border-t border-white/10 pt-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">Drive</span>
                <span className="text-amber-300">+{telemetry.driveDb.toFixed(1)} dB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Out</span>
                <span className="text-slate-200">
                  {telemetry.outRmsDb <= -59 ? '-∞' : `${telemetry.outRmsDb.toFixed(1)} dB`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Grid */}
        <div className="px-4 py-4 grid grid-cols-6 gap-2.5 bg-[#0a0d14] border-t border-white/5">
          {[
            { key: 'drive', label: 'Drive', min: 0, max: 100, def: 32, unit: '%', decimals: 0 },
            { key: 'harmonics', label: 'Even / Odd', min: -100, max: 100, def: 38, unit: '%', decimals: 0 },
            { key: 'lowCut', label: 'Pre HPF', min: 20, max: 500, def: 85, unit: 'Hz', decimals: 0 },
            { key: 'tone', label: 'Tone LP', min: 800, max: 18000, def: 7200, unit: 'Hz', decimals: 0 },
            { key: 'outputDb', label: 'Output', min: -18, max: 12, def: 0, unit: 'dB', decimals: 1 },
            { key: 'mix', label: 'Mix', min: 0, max: 100, def: 75, unit: '%', decimals: 0 },
          ].map((k) => {
            const val = getVal(k.key, k.def);
            return (
              <div key={k.key} className="flex flex-col items-center gap-1.5">
                <span className="text-[10.5px] text-slate-400 font-medium truncate max-w-full">
                  {k.label}
                </span>
                <RotaryKnob
                  value={val}
                  min={k.min}
                  max={k.max}
                  defaultValue={k.def}
                  size={44}
                  neonColor={plugin.enabled ? channel.neonAccent : '#64748b'}
                  label={k.label}
                  onChange={(v) => setParam(k.key, v)}
                />
                <span className="text-[11px] font-mono tabular-nums text-[var(--theme-neon-soft)]">
                  {val.toFixed(k.decimals)} {k.unit}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
