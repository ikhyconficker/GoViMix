import React, { useEffect, useRef } from 'react';
import { Power, Sparkles, Square, X } from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin, SpecialEffectPad } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface SpecialEffectModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  pads?: SpecialEffectPad[];
  onTriggerPad?: (pad: SpecialEffectPad) => void;
  onStopAll?: () => void;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

export const SpecialEffectModal: React.FC<SpecialEffectModalProps> = ({
  channel,
  plugin,
  pads = [],
  onTriggerPad,
  onStopAll,
  onClose,
  onUpdatePlugin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pitch = plugin.params.pitch ?? 0;
  const tone = plugin.params.tone ?? 4200;
  const drive = plugin.params.drive ?? 18;
  const mix = plugin.params.mix ?? 100;
  const themeNeon = channel.neonAccent || '#eaff00';

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (p) => ({
      ...p,
      params: { ...p.params, [key]: val },
    }));
  };

  useEffect(() => {
    let raf = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          ctx.fillStyle = '#070a10';
          ctx.fillRect(0, 0, w, h);

          ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
          ctx.lineWidth = 1;
          for (let gx = 1; gx < 8; gx++) {
            const x = (w / 8) * gx;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
          }
          for (let gy = 1; gy < 4; gy++) {
            const y = (h / 4) * gy;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }

          const fft = audioEngine.getChannelSpectrum(channel.id);
          ctx.beginPath();
          ctx.moveTo(0, h);
          const bins = 96;
          for (let i = 0; i < bins; i++) {
            const val = (fft[i * 2] ?? 0) / 255;
            const x = (i / (bins - 1)) * w;
            const y = h - val * (h * 0.84);
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();
          const grad = ctx.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, `${themeNeon}73`);
          grad.addColorStop(1, `${themeNeon}08`);
          ctx.fillStyle = grad;
          ctx.fill();

          // Tone lowpass curve preview
          ctx.beginPath();
          ctx.strokeStyle = plugin.enabled ? themeNeon : '#64748b';
          ctx.lineWidth = 2;
          for (let px = 0; px <= w; px += 4) {
            const freq = 20 * Math.pow(1000, px / w);
            const slope = freq > tone ? -12 * Math.log2(freq / Math.max(200, tone)) : 0;
            const driveBoost = (drive / 100) * 3;
            const y = Math.min(h - 6, Math.max(8, h * 0.35 - (driveBoost + slope) * 3.2));
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
          }
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [channel.id, drive, plugin.enabled, themeNeon, tone]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] rounded-lg bg-[#0d121c] border border-[rgba(var(--theme-neon-rgb),0.45)] shadow-[0_24px_80px_rgba(0,0,0,0.85)] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#121826] border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (p) => ({ ...p, enabled: !p.enabled }))
              }
              className={`p-1.5 rounded border transition-all ${
                plugin.enabled
                  ? 'bg-[rgba(var(--theme-neon-rgb),0.2)] text-[var(--theme-neon-soft)] border-[rgba(var(--theme-neon-rgb),0.7)] shadow-[0_0_10px_rgba(var(--theme-neon-rgb),0.45)]'
                  : 'bg-[#1a202d] text-slate-500 border-white/10'
              }`}
            >
              <Power className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="w-4 h-4 text-[var(--theme-neon)]" />
                <span>{plugin.name}</span>
                <span className="text-[10px] font-mono-tabular text-[var(--theme-neon-soft)]">
                  {plugin.format ?? 'VST3'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                {plugin.vendor ?? 'GoViMix DSP'} · Insert on{' '}
                <span className="text-[var(--theme-neon-soft)] font-semibold">
                  {channel.name || `Ch ${channel.index}`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onStopAll && (
              <button
                type="button"
                onClick={onStopAll}
                className="px-2.5 py-1 rounded bg-[#182030] hover:bg-rose-500/20 border border-white/10 hover:border-rose-400/50 text-[11px] text-slate-200 flex items-center gap-1"
              >
                <Square className="w-3 h-3 fill-current" />
                Stop FX
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Visualizer */}
        <div className="p-4 pb-2">
          <div className="rounded border border-white/10 overflow-hidden bg-[#070a10]">
            <canvas ref={canvasRef} width={608} height={130} className="w-full h-[130px] block" />
          </div>
        </div>

        {/* Global Special Effect DSP Knobs */}
        <div className="px-4 py-3 grid grid-cols-4 gap-3 bg-[#0a0e16] border-t border-white/5">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10.5px] text-slate-400 font-medium">Master Pitch</span>
            <RotaryKnob
              value={pitch}
              min={-12}
              max={12}
              defaultValue={0}
              size={44}
              neonColor={plugin.enabled ? themeNeon : '#64748b'}
              label="Master Pitch"
              onChange={(v) => setParam('pitch', Math.round(v))}
            />
            <span className="text-[11px] font-mono-tabular text-[var(--theme-neon-soft)]">
              {pitch > 0 ? `+${pitch.toFixed(0)}` : pitch.toFixed(0)} st
            </span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="text-[10.5px] text-slate-400 font-medium">Tone Filter</span>
            <RotaryKnob
              value={tone}
              min={600}
              max={16000}
              defaultValue={4200}
              size={44}
              neonColor={plugin.enabled ? themeNeon : '#64748b'}
              label="Tone Filter"
              onChange={(v) => setParam('tone', Math.round(v))}
            />
            <span className="text-[11px] font-mono-tabular text-[var(--theme-neon-soft)]">
              {tone >= 1000 ? `${(tone / 1000).toFixed(1)} kHz` : `${Math.round(tone)} Hz`}
            </span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="text-[10.5px] text-slate-400 font-medium">Punch Drive</span>
            <RotaryKnob
              value={drive}
              min={0}
              max={100}
              defaultValue={18}
              size={44}
              neonColor={plugin.enabled ? themeNeon : '#64748b'}
              label="Punch Drive"
              onChange={(v) => setParam('drive', Math.round(v))}
            />
            <span className="text-[11px] font-mono-tabular text-[var(--theme-neon-soft)]">
              {Math.round(drive)} %
            </span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="text-[10.5px] text-slate-400 font-medium">FX Mix</span>
            <RotaryKnob
              value={mix}
              min={0}
              max={100}
              defaultValue={100}
              size={44}
              neonColor={plugin.enabled ? themeNeon : '#64748b'}
              label="FX Mix"
              onChange={(v) => setParam('mix', Math.round(v))}
            />
            <span className="text-[11px] font-mono-tabular text-[var(--theme-neon-soft)]">
              {Math.round(mix)} %
            </span>
          </div>
        </div>

        {/* 30 Quick Trigger Pads inside Plugin Window */}
        {pads.length > 0 && onTriggerPad && (
          <div className="px-4 py-3 bg-[#090c13] border-t border-white/10">
            <div className="text-[10px] font-semibold text-[var(--theme-neon-soft)] mb-2">
              Quick Trigger Soundbank ({pads.length} Pads)
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {pads.map((pad) => (
                <button
                  key={pad.id}
                  type="button"
                  onClick={() => onTriggerPad(pad)}
                  className="px-1.5 py-1.5 rounded bg-[#121927] hover:bg-[rgba(var(--theme-neon-rgb),0.2)] border border-[rgba(var(--theme-neon-rgb),0.25)] hover:border-[var(--theme-neon)] text-left transition-all"
                >
                  <div className="flex items-center justify-between text-[8.5px] text-[var(--theme-neon)] font-mono-tabular">
                    <span>{String(pad.index).padStart(2, '0')}</span>
                    <span className="text-slate-500">{(pad.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                  <div className="text-[9.5px] font-medium text-slate-100 truncate">
                    {pad.label || `FX ${pad.index}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
