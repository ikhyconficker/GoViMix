import React, { useEffect, useRef } from 'react';
import { Mic2, Power, Sparkles, X } from 'lucide-react';
import { audioEngine, linearToDb } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface HarmonyModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = ['Major', 'Minor', 'Harmonic Min', 'Pentatonic', 'Chromatic'] as const;

const INTERVAL_OPTIONS = [
  { val: -12, label: '-12 st (Oct Down)' },
  { val: -7, label: '-7 st (5th Down)' },
  { val: -5, label: '-5 st (4th Down)' },
  { val: -4, label: '-4 st (3rd Down)' },
  { val: -3, label: '-3 st (m3rd Down)' },
  { val: 0, label: '0 st (Unison)' },
  { val: 3, label: '+3 st (m3rd Up)' },
  { val: 4, label: '+4 st (3rd Up)' },
  { val: 5, label: '+5 st (4th Up)' },
  { val: 7, label: '+7 st (5th Up)' },
  { val: 12, label: '+12 st (Oct Up)' },
];

const VOICE_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24'];

const DEFAULT_VOICES = [
  { interval: 4, pan: -35, level: -2, detune: 8 },
  { interval: 7, pan: 35, level: -3, detune: -8 },
  { interval: -5, pan: -65, level: -5, detune: 12 },
  { interval: 12, pan: 65, level: -6, detune: -12 },
];

export const HarmonyModal: React.FC<HarmonyModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef(0);

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  const voiceCount = Math.max(1, Math.min(4, Math.round(getVal('voiceCount', 2))));
  const keyIdx = Math.max(0, Math.min(11, Math.round(getVal('keyIdx', 0))));
  const scaleIdx = Math.max(0, Math.min(SCALES.length - 1, Math.round(getVal('scaleIdx', 0))));
  const pitchCorrectOn = getVal('pitchCorrectOn', 1) === 1;
  const retuneSpeed = getVal('retuneSpeed', 18);
  const humanize = getVal('humanize', 25);
  const formant = getVal('formant', 0);
  const dryLevel = getVal('dryLevel', 100);
  const mix = getVal('mix', 75);
  const width = getVal('width', 110);

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => ({
      ...prev,
      params: { ...prev.params, [key]: val },
    }));
  };

  useEffect(() => {
    let raf = 0;
    const render = () => {
      phaseRef.current += 0.04;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          ctx.fillStyle = '#070a10';
          ctx.fillRect(0, 0, w, h);

          // Piano/Semitone grid lines
          const rows = 16;
          for (let r = 1; r < rows; r++) {
            const y = (r / rows) * h;
            ctx.strokeStyle = r % 4 === 0 ? 'rgba(56, 189, 248, 0.16)' : 'rgba(148, 163, 184, 0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }

          // Vertical time grid
          for (let c = 1; c < 8; c++) {
            const x = (c / 8) * w;
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
          }

          const metrics = audioEngine.getChannelStereoMetrics(channel.id);
          const audioDb = linearToDb(Math.max(metrics.rmsL, metrics.rmsR));
          const energy = Math.max(0.15, Math.min(1, (audioDb + 50) / 45));

          // Lead raw pitch vs quantized corrected pitch contour
          const midY = h * 0.52;
          const corrStrength = pitchCorrectOn ? 1 - retuneSpeed / 220 : 0;

          // Raw vibrato contour (dashed slate)
          ctx.beginPath();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
          ctx.lineWidth = 1.5;
          for (let px = 0; px <= w; px += 4) {
            const t = phaseRef.current + (px / w) * 8;
            const vibrato = Math.sin(t * 2.2) * 14 * energy + Math.sin(t * 0.7) * 18;
            const y = midY + vibrato;
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // Pitch-corrected Lead line (glowing cyan/white)
          ctx.beginPath();
          ctx.strokeStyle = plugin.enabled ? '#e0f2fe' : '#64748b';
          ctx.lineWidth = 2.2;
          for (let px = 0; px <= w; px += 4) {
            const t = phaseRef.current + (px / w) * 8;
            const rawOff = Math.sin(t * 2.2) * 14 * energy + Math.sin(t * 0.7) * 18;
            const quantized = Math.round(rawOff / 18) * 18;
            const y = midY + rawOff * (1 - corrStrength * 0.85) + quantized * (corrStrength * 0.85);
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
          }
          ctx.stroke();

          // Harmony Voice Tracks (1..voiceCount)
          if (plugin.enabled) {
            for (let v = 0; v < voiceCount; v++) {
              const interval = getVal(`v${v}_interval`, DEFAULT_VOICES[v].interval);
              const color = VOICE_COLORS[v];
              const yOffset = -interval * 3.4;

              ctx.beginPath();
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.shadowColor = color;
              ctx.shadowBlur = 6;
              for (let px = 0; px <= w; px += 4) {
                const t = phaseRef.current + (px / w) * 8;
                const rawOff = Math.sin(t * 2.2) * 10 * (humanize / 100) + Math.sin(t * 0.7) * 14;
                const quantized = Math.round(rawOff / 18) * 18;
                const y = Math.max(
                  8,
                  Math.min(
                    h - 8,
                    midY + yOffset + rawOff * (1 - corrStrength * 0.85) + quantized * (corrStrength * 0.85)
                  )
                );
                if (px === 0) ctx.moveTo(px, y);
                else ctx.lineTo(px, y);
              }
              ctx.stroke();
              ctx.shadowBlur = 0;
            }
          }

          // Status badge inside canvas
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(8, 8, 224, 22);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
          ctx.strokeRect(8, 8, 224, 22);
          ctx.fillStyle = '#bae6fd';
          ctx.font = '10.5px ui-monospace, monospace';
          ctx.fillText(
            `Scale: ${KEYS[keyIdx]} ${SCALES[scaleIdx]} · ${voiceCount} Suara`,
            15,
            23
          );
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [channel.id, humanize, keyIdx, pitchCorrectOn, plugin.enabled, plugin.params, retuneSpeed, scaleIdx, voiceCount]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[880px] rounded-lg bg-[#141720] border border-indigo-500/40 shadow-[0_28px_90px_rgba(0,0,0,0.92)] overflow-hidden select-none text-slate-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#0e1118] border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1.5 rounded border transition-all ${
                plugin.enabled
                  ? 'bg-indigo-500/25 text-indigo-300 border-indigo-400/70 shadow-[0_0_10px_rgba(129,140,248,0.45)]'
                  : 'bg-[#222632] text-slate-500 border-white/10'
              }`}
              title="Enable / Bypass Harmony"
            >
              <Power className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>{plugin.name} · Pitch Correction &amp; Choir</span>
                <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-400/30">
                  {plugin.format}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                Insert on <strong style={{ color: channel.neonAccent }}>{channel.name || `Ch ${channel.index}`}</strong>
              </div>
            </div>
          </div>

          {/* Voice Count Selector (1 / 2 / 3 / 4 Suara) */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-medium">Mode Harmoni:</span>
            <div className="flex items-center bg-[#090c12] p-0.5 rounded border border-white/10">
              {[1, 2, 3, 4].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setParam('voiceCount', cnt)}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                    voiceCount === cnt
                      ? 'bg-indigo-500 text-white shadow-[0_0_10px_rgba(99,102,241,0.6)]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {cnt} Suara
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Top Body: Pitch Graph + Pitch Correction Engine */}
        <div className="grid grid-cols-[1.45fr_1fr] gap-2 p-2.5 bg-[#10131b]">
          {/* Live Pitch Correction & Harmony Contour Graph */}
          <div className="rounded border border-white/10 bg-[#070a10] overflow-hidden">
            <canvas ref={canvasRef} width={470} height={155} className="w-full h-[155px] block" />
          </div>

          {/* Pitch Correction Panel */}
          <div className="rounded border border-white/10 bg-[#181c26] p-3 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Mic2 className="w-3.5 h-3.5 text-cyan-400" />
                Pitch Correction
              </span>
              <button
                type="button"
                onClick={() => setParam('pitchCorrectOn', pitchCorrectOn ? 0 : 1)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                  pitchCorrectOn
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/60'
                    : 'bg-[#0e1118] text-slate-500 border-white/10'
                }`}
              >
                {pitchCorrectOn ? 'AUTO-TUNE ON' : 'BYPASSED'}
              </button>
            </div>

            {/* Key & Scale */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400">Root Key</span>
                <select
                  value={keyIdx}
                  onChange={(e) => setParam('keyIdx', Number(e.target.value))}
                  className="bg-[#0b0e15] border border-white/15 rounded px-2 py-1 text-xs text-cyan-300 font-semibold focus:outline-none"
                >
                  {KEYS.map((k, idx) => (
                    <option key={k} value={idx}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400">Scale</span>
                <select
                  value={scaleIdx}
                  onChange={(e) => setParam('scaleIdx', Number(e.target.value))}
                  className="bg-[#0b0e15] border border-white/15 rounded px-2 py-1 text-xs text-cyan-300 font-semibold focus:outline-none"
                >
                  {SCALES.map((s, idx) => (
                    <option key={s} value={idx}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Retune Speed / Humanize / Formant */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-slate-400">Retune</span>
                <RotaryKnob
                  value={retuneSpeed}
                  min={0}
                  max={200}
                  defaultValue={18}
                  size={34}
                  neonColor={pitchCorrectOn ? '#22d3ee' : '#64748b'}
                  label="Retune Speed"
                  onChange={(v) => setParam('retuneSpeed', v)}
                />
                <span className="text-[10px] font-mono-tabular text-slate-200">{retuneSpeed.toFixed(0)} ms</span>
              </div>

              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-slate-400">Humanize</span>
                <RotaryKnob
                  value={humanize}
                  min={0}
                  max={100}
                  defaultValue={25}
                  size={34}
                  neonColor={pitchCorrectOn ? '#22d3ee' : '#64748b'}
                  label="Humanize"
                  onChange={(v) => setParam('humanize', v)}
                />
                <span className="text-[10px] font-mono-tabular text-slate-200">{humanize.toFixed(0)} %</span>
              </div>

              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-slate-400">Formant</span>
                <RotaryKnob
                  value={formant}
                  min={-12}
                  max={12}
                  defaultValue={0}
                  size={34}
                  neonColor="#a78bfa"
                  label="Formant Shift"
                  onChange={(v) => setParam('formant', v)}
                />
                <span className="text-[10px] font-mono-tabular text-slate-200">
                  {formant >= 0 ? `+${formant.toFixed(1)}` : formant.toFixed(1)} st
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Body: 4 Harmony Voices + Global Output */}
        <div className="grid grid-cols-[1fr_170px] gap-2 px-2.5 pb-2.5 bg-[#10131b]">
          {/* 4 Voice Cards */}
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((vIdx) => {
              const active = vIdx < voiceCount;
              const color = VOICE_COLORS[vIdx];
              const def = DEFAULT_VOICES[vIdx];
              const interval = Math.round(getVal(`v${vIdx}_interval`, def.interval));
              const pan = getVal(`v${vIdx}_pan`, def.pan);
              const level = getVal(`v${vIdx}_level`, def.level);
              const detune = getVal(`v${vIdx}_detune`, def.detune);

              return (
                <div
                  key={vIdx}
                  onClick={() => {
                    if (!active) setParam('voiceCount', vIdx + 1);
                  }}
                  className={`rounded border p-2.5 flex flex-col justify-between gap-2 transition-all ${
                    active
                      ? 'bg-[#181c28] border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                      : 'bg-[#11141c] border-white/5 opacity-45 hover:opacity-75 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-white flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          backgroundColor: active ? color : '#475569',
                          boxShadow: active ? `0 0 6px ${color}` : 'none',
                        }}
                      />
                      Suara {vIdx + 1}
                    </span>
                    <span className="text-[9.5px] font-mono-tabular text-slate-400">
                      {active ? 'ON' : 'OFF'}
                    </span>
                  </div>

                  {/* Interval Select */}
                  <select
                    value={interval}
                    disabled={!active}
                    onChange={(e) => setParam(`v${vIdx}_interval`, Number(e.target.value))}
                    className="w-full bg-[#0b0e15] border border-white/15 rounded px-1.5 py-1 text-[10.5px] text-slate-100 focus:outline-none"
                  >
                    {INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.val} value={opt.val}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <div className="grid grid-cols-3 gap-1 pt-0.5">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-slate-400">Pan</span>
                      <RotaryKnob
                        value={pan}
                        min={-100}
                        max={100}
                        defaultValue={def.pan}
                        size={28}
                        neonColor={active ? color : '#64748b'}
                        label={`Voice ${vIdx + 1} Pan`}
                        onChange={(v) => setParam(`v${vIdx}_pan`, v)}
                      />
                      <span className="text-[9px] font-mono-tabular text-slate-300">
                        {Math.abs(pan) < 2 ? 'C' : pan < 0 ? `L${Math.abs(Math.round(pan))}` : `R${Math.round(pan)}`}
                      </span>
                    </div>

                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-slate-400">Level</span>
                      <RotaryKnob
                        value={level}
                        min={-24}
                        max={6}
                        defaultValue={def.level}
                        size={28}
                        neonColor={active ? color : '#64748b'}
                        label={`Voice ${vIdx + 1} Level`}
                        onChange={(v) => setParam(`v${vIdx}_level`, v)}
                      />
                      <span className="text-[9px] font-mono-tabular text-slate-300">
                        {level.toFixed(1)}
                      </span>
                    </div>

                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-slate-400">Fine</span>
                      <RotaryKnob
                        value={detune}
                        min={-30}
                        max={30}
                        defaultValue={def.detune}
                        size={28}
                        neonColor={active ? color : '#64748b'}
                        label={`Voice ${vIdx + 1} Fine Detune`}
                        onChange={(v) => setParam(`v${vIdx}_detune`, v)}
                      />
                      <span className="text-[9px] font-mono-tabular text-slate-300">
                        {detune >= 0 ? `+${Math.round(detune)}` : Math.round(detune)}ct
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Global Harmony Output */}
          <div className="rounded border border-white/10 bg-[#181c28] p-2.5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-white">Global Output</span>
            <div className="grid grid-cols-2 gap-2 my-1">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[9.5px] text-slate-400">Dry Lead</span>
                <RotaryKnob
                  value={dryLevel}
                  min={0}
                  max={100}
                  defaultValue={100}
                  size={34}
                  neonColor="#38bdf8"
                  label="Dry Lead"
                  onChange={(v) => setParam('dryLevel', v)}
                />
                <span className="text-[9.5px] font-mono-tabular text-slate-200">{dryLevel.toFixed(0)}%</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[9.5px] text-slate-400">Width</span>
                <RotaryKnob
                  value={width}
                  min={0}
                  max={200}
                  defaultValue={110}
                  size={34}
                  neonColor="#a78bfa"
                  label="Stereo Width"
                  onChange={(v) => setParam('width', v)}
                />
                <span className="text-[9.5px] font-mono-tabular text-slate-200">{width.toFixed(0)}%</span>
              </div>
            </div>

            <div className="flex flex-col items-center gap-1 pt-1 border-t border-white/10">
              <span className="text-[10px] text-slate-300 font-medium">Harmony Mix</span>
              <RotaryKnob
                value={mix}
                min={0}
                max={100}
                defaultValue={75}
                size={40}
                neonColor="#818cf8"
                label="Harmony Mix"
                onChange={(v) => setParam('mix', v)}
              />
              <span className="text-[10.5px] font-mono-tabular text-indigo-300 font-semibold">
                {mix.toFixed(0)} %
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
