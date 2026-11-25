import React, { useEffect, useRef } from 'react';
import { Power, X } from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { CompressorModal } from './CompressorModal';
import { DelayModal } from './DelayModal';
import { EqualizerModal } from './EqualizerModal';
import { GateModal } from './GateModal';
import { HarmonyModal } from './HarmonyModal';
import { LimiterModal } from './LimiterModal';
import { MultibandDynamicsModal } from './MultibandDynamicsModal';
import { ReverbModal } from './ReverbModal';
import { RotaryKnob } from './RotaryKnob';
import { SpectrumModal } from './SpectrumModal';
import { VuMeterModal } from './VuMeterModal';
import { WiderModal } from './WiderModal';

interface PluginModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (channelId: string, pluginId: string, updater: (p: InsertPlugin) => InsertPlugin) => void;
}

export const PluginModal: React.FC<PluginModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isVuMeter = plugin.type === 'meter' && plugin.name.toLowerCase().includes('vu');
  const hasDedicatedModal =
    plugin.type === 'multiband' ||
    plugin.type === 'pro-eq' ||
    plugin.type === 'pro-q' ||
    plugin.type === 'compressor' ||
    plugin.type === 'wider' ||
    plugin.type === 'limiter' ||
    plugin.type === 'spectrum' ||
    plugin.type === 'reverb' ||
    plugin.type === 'gate' ||
    plugin.type === 'delay' ||
    plugin.type === 'harmony' ||
    isVuMeter;

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (p) => ({
      ...p,
      params: { ...p.params, [key]: val },
    }));
  };

  useEffect(() => {
    if (hasDedicatedModal) {
      return;
    }
    let raf = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Dark studio grid
          ctx.fillStyle = '#07090e';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
          ctx.lineWidth = 1;
          for (let gx = 1; gx < 6; gx++) {
            const x = (w / 6) * gx;
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

          // Live FFT Spectrum Background
          const fft = audioEngine.getChannelSpectrum(channel.id);
          ctx.beginPath();
          ctx.moveTo(0, h);
          const bins = 96;
          for (let i = 0; i < bins; i++) {
            const val = (fft[i * 2] ?? 0) / 255;
            const x = (i / (bins - 1)) * w;
            const y = h - val * (h * 0.85);
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();
          const grad = ctx.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, `${channel.neonAccent}55`);
          grad.addColorStop(1, `${channel.neonAccent}05`);
          ctx.fillStyle = grad;
          ctx.fill();

          // Plugin-specific curve
          if (plugin.type === 'megaphone') {
            const lowGain = plugin.params.lowGain ?? 0;
            const midFreq = plugin.params.midFreq ?? plugin.params.focusHz ?? 1200;
            const midGain = plugin.params.midGain ?? 6;
            const highGain = plugin.params.highGain ?? 0;
            const lowCut = plugin.params.lowCut ?? 40;

            ctx.beginPath();
            ctx.strokeStyle = plugin.enabled ? channel.neonAccent : '#64748b';
            ctx.lineWidth = 2.4;
            ctx.shadowColor = plugin.enabled ? channel.neonAccent : 'transparent';
            ctx.shadowBlur = plugin.enabled ? 10 : 0;

            for (let px = 0; px <= w; px += 4) {
              const freq = 20 * Math.pow(1000, px / w); // 20Hz..20kHz log
              let db = 0;
              if (freq < lowCut) {
                db -= 18 * Math.log2(lowCut / Math.max(20, freq));
              }
              if (freq < 220) {
                db += lowGain * (1 - freq / 220);
              }
              const dist = Math.abs(Math.log2(freq / midFreq));
              db += midGain * Math.exp(-dist * dist * 1.6);
              if (freq > 3500) {
                db += highGain * Math.min(1, (freq - 3500) / 6000);
              }
              if (freq < 450 || freq > 4000) {
                db -= 10;
              }
              const y = h / 2 - (db / 18) * (h / 2 - 12);
              if (px === 0) ctx.moveTo(px, y);
              else ctx.lineTo(px, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [channel.id, channel.neonAccent, hasDedicatedModal, plugin]);

  if (plugin.type === 'multiband') {
    return (
      <MultibandDynamicsModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (plugin.type === 'pro-eq' || plugin.type === 'pro-q') {
    return (
      <EqualizerModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (plugin.type === 'compressor') {
    return (
      <CompressorModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (plugin.type === 'wider') {
    return (
      <WiderModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (plugin.type === 'limiter') {
    return (
      <LimiterModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (plugin.type === 'spectrum') {
    return (
      <SpectrumModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (isVuMeter) {
    return (
      <VuMeterModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (plugin.type === 'reverb') {
    return (
      <ReverbModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (plugin.type === 'gate') {
    return (
      <GateModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (plugin.type === 'delay') {
    return (
      <DelayModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  if (plugin.type === 'harmony') {
    return (
      <HarmonyModal
        channel={channel}
        plugin={plugin}
        onClose={onClose}
        onUpdatePlugin={onUpdatePlugin}
      />
    );
  }

  const knobDefs: { key: string; label: string; min: number; max: number; def: number; unit: string }[] = (() => {
    switch (plugin.type) {
      case 'megaphone':
        return [
          { key: 'focusHz', label: 'Band Focus', min: 600, max: 3200, def: 1450, unit: 'Hz' },
          { key: 'q', label: 'Resonance Q', min: 0.5, max: 6, def: 2.4, unit: '' },
          { key: 'drive', label: 'Drive', min: 0, max: 100, def: 35, unit: '%' },
          { key: 'mix', label: 'Mix', min: 0, max: 100, def: 85, unit: '%' },
        ];
      case 'ducking':
        return [
          { key: 'threshold', label: 'Threshold', min: -48, max: 0, def: -24, unit: 'dB' },
          { key: 'depth', label: 'Duck Depth', min: -24, max: 0, def: -6, unit: 'dB' },
          { key: 'attack', label: 'Attack', min: 1, max: 80, def: 8, unit: 'ms' },
          { key: 'release', label: 'Release', min: 30, max: 600, def: 180, unit: 'ms' },
        ];
      default:
        return [
          { key: 'threshold', label: 'Intensity', min: -48, max: 12, def: 0, unit: 'dB' },
          { key: 'mix', label: 'Mix', min: 0, max: 100, def: 75, unit: '%' },
        ];
    }
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[540px] rounded-lg bg-[#0d1119] border border-cyan-500/35 shadow-[0_24px_80px_rgba(0,0,0,0.85)] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#121824] border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (p) => ({ ...p, enabled: !p.enabled }))
              }
              className={`p-1.5 rounded border transition-all ${
                plugin.enabled
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/60 shadow-[0_0_10px_rgba(34,211,238,0.4)]'
                  : 'bg-[#1a202d] text-slate-500 border-white/10'
              }`}
            >
              <Power className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white leading-tight">
                <span>{plugin.name}</span>
                <span className="text-[10px] font-mono-tabular text-cyan-300">
                  {plugin.format ?? 'VST3'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                {plugin.vendor ?? 'Studio DSP'} · Insert on{' '}
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

        {/* Visualizer Canvas */}
        <div className="p-4 pb-2">
          <div className="rounded border border-white/10 overflow-hidden bg-[#07090e]">
            <canvas ref={canvasRef} width={508} height={170} className="w-full h-[170px] block" />
          </div>
        </div>

        {/* Parameter Knobs */}
        <div className="px-4 py-4 grid grid-cols-5 gap-3 bg-[#0a0d14] border-t border-white/5">
          {knobDefs.map((k) => {
            const val = plugin.params[k.key] ?? k.def;
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
                <span className="text-[11px] font-mono-tabular text-cyan-300">
                  {val.toFixed(k.unit === 's' || k.key === 'ceiling' ? 1 : 0)} {k.unit}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
