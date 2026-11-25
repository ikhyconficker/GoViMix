import React, { useEffect, useState } from 'react';
import { Power, X } from 'lucide-react';
import { audioEngine, linearToDb } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface LimiterModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

const SCALE_POINTS = [
  { db: -60, label: '-60' },
  { db: -48, label: '-48' },
  { db: -36, label: '-36' },
  { db: -24, label: '-24' },
  { db: -12, label: '-12' },
  { db: -9, label: '-9' },
  { db: -6, label: '-6' },
  { db: -3, label: '-3' },
  { db: 0, label: '0' },
  { db: 3, label: '3' },
  { db: 6, label: '6' },
];

export const LimiterModal: React.FC<LimiterModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const [livePeakDb, setLivePeakDb] = useState(-60);
  const [reductionDb, setReductionDb] = useState(0);

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  const gain = getVal('gain', 1.0);
  const ceiling = getVal('ceiling', -3.24);
  const threshold = getVal('threshold', -3.0);
  const release = getVal('release', 180.0);
  const softClip = getVal('softClip', 0) === 1;
  const truePeak = getVal('truePeak', 1) === 1;
  const meterMode = getVal('meterMode', 0); // 0: Peak/RMS, 1: K-20, 2: K-14, 3: K-12
  const attackMode = getVal('attackMode', 1); // 0: Fast, 1: Normal, 2: Slow
  const limiterModeIdx = getVal('limiterMode', 1); // 0: A, 1: B, 2: C

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => ({
      ...prev,
      params: { ...prev.params, [key]: val },
    }));
  };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const metrics = audioEngine.getChannelStereoMetrics(channel.id);
      const peak = Math.max(metrics.peakL, metrics.peakR);
      const db = linearToDb(peak);
      setLivePeakDb(db);
      setReductionDb(plugin.enabled ? audioEngine.getChannelReduction(channel.id) : 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [channel.id, plugin.enabled]);

  // Map -60..+6 to 0..100%
  const dbToPct = (db: number) => Math.max(0, Math.min(100, ((db + 60) / 66) * 100));
  const ceilingPct = dbToPct(ceiling);
  const livePct = dbToPct(livePeakDb);
  const redNorm = Math.min(100, (Math.abs(reductionDb) / 24) * 100);
  const modeLetters = ['A', 'B', 'C'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[630px] rounded-md bg-[#1f2126] border border-[#0f1013] shadow-[0_28px_90px_rgba(0,0,0,0.92)] overflow-hidden select-none text-slate-200"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-[#0b0d11] border-b border-black">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1 rounded border transition-all ${
                plugin.enabled
                  ? 'bg-[#0b6ef6]/25 text-[#3ba3ff] border-[#1f84ff]/70 shadow-[0_0_8px_rgba(31,132,255,0.45)]'
                  : 'bg-[#2a2d33] text-slate-500 border-black'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="text-[16px] font-normal tracking-tight text-white">
              Limiter<sup className="text-[10px] ml-0.5">2</sup>
            </span>
            <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-white/5 text-[#38bdf8] border border-white/10">
              {plugin.format}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setParam('softClip', softClip ? 0 : 1)}
              className={`px-3 py-1 rounded text-[11px] font-medium border transition-colors ${
                softClip
                  ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                  : 'bg-[#252c36] text-[#60a5fa] border-[#15181e]'
              }`}
            >
              Soft Clip
            </button>
            <button
              type="button"
              onClick={() => setParam('truePeak', truePeak ? 0 : 1)}
              className={`px-3 py-1 rounded text-[11px] font-medium border transition-colors ${
                truePeak
                  ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                  : 'bg-[#252c36] text-[#60a5fa] border-[#15181e]'
              }`}
            >
              True Peak
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Horizontal Segmented Meter & Scale (Image 3) */}
        <div className="bg-[#090b0f] px-3 pt-3 pb-2 border-b border-black">
          {/* Segmented LED Strip */}
          <div className="relative h-7 w-full flex items-center gap-[3px]">
            {Array.from({ length: 64 }).map((_, idx) => {
              const segPct = (idx / 63) * 100;
              const active = plugin.enabled && segPct <= livePct && livePeakDb > -59;
              const isHot = segPct >= dbToPct(0);
              return (
                <div
                  key={idx}
                  className="flex-1 h-full rounded-[1px] transition-colors duration-75"
                  style={{
                    backgroundColor: active
                      ? isHot
                        ? '#ef4444'
                        : '#38bdf8'
                      : isHot
                      ? 'rgba(56, 189, 248, 0.16)'
                      : 'rgba(148, 163, 184, 0.13)',
                  }}
                />
              );
            })}
            {/* Ceiling marker line */}
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-[#7dd3fc] shadow-[0_0_6px_#38bdf8]"
              style={{ left: `${ceilingPct}%` }}
            />
          </div>

          {/* Scale Numbers */}
          <div className="relative h-4 mt-1 text-[9.5px] font-mono-tabular text-[#6da8dc]">
            {SCALE_POINTS.map((pt) => (
              <span
                key={pt.db}
                className="absolute -translate-x-1/2"
                style={{ left: `${dbToPct(pt.db)}%` }}
              >
                {pt.label}
              </span>
            ))}
          </div>

          {/* Gain Reduction Strip */}
          <div className="mt-1 h-1.5 w-full bg-[#1a1f27] rounded-sm overflow-hidden flex justify-end">
            <div
              className="h-full bg-gradient-to-l from-[#f97316] to-[#ef4444] transition-all duration-75"
              style={{ width: `${redNorm}%` }}
            />
          </div>

          {/* Metering Modes + Reduction Readout */}
          <div className="flex items-center justify-between mt-2.5">
            <div className="flex items-center gap-1">
              {['Peak/RMS', 'K-20', 'K-14', 'K-12'].map((lbl, idx) => (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => setParam('meterMode', idx)}
                  className={`px-3 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                    meterMode === idx
                      ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                      : 'bg-[#25282e] text-[#60a5fa] border-black/70 hover:text-white'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[11.5px]">
              <span className="text-slate-300">Reduction</span>
              <span className="font-mono-tabular text-[#38bdf8] font-semibold min-w-[54px] text-right">
                {reductionDb.toFixed(2)} dB
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Controls: Input & Envelope */}
        <div className="grid grid-cols-[1.75fr_1fr] gap-1.5 p-1.5 bg-[#1b1d21]">
          {/* Input Panel */}
          <div className="bg-[#5a5c61] rounded border border-[#2d2f33] p-3 flex flex-col justify-between">
            <div className="text-[14px] font-normal text-[#d8dadf] mb-2">Input</div>
            <div className="flex items-center justify-around gap-3 pb-1">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11.5px] text-[#d4d6db]">Gain</span>
                <RotaryKnob
                  value={gain}
                  min={0}
                  max={24}
                  defaultValue={1.0}
                  size={50}
                  neonColor="#2196f3"
                  label="Input Gain"
                  onChange={(v) => setParam('gain', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">{gain.toFixed(2)} dB</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[11.5px] text-[#d4d6db]">Ceiling</span>
                <RotaryKnob
                  value={ceiling}
                  min={-12}
                  max={0}
                  defaultValue={-3.24}
                  size={50}
                  neonColor="#2196f3"
                  label="Ceiling"
                  onChange={(v) => setParam('ceiling', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">{ceiling.toFixed(2)} dB</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[11.5px] text-[#d4d6db]">Threshold</span>
                <RotaryKnob
                  value={threshold}
                  min={-24}
                  max={0}
                  defaultValue={-3.0}
                  size={50}
                  neonColor="#2196f3"
                  label="Threshold"
                  onChange={(v) => setParam('threshold', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">{threshold.toFixed(2)} dB</span>
              </div>

              {/* A / B / C Mode Box */}
              <button
                type="button"
                onClick={() => setParam('limiterMode', (limiterModeIdx + 1) % 3)}
                className="flex flex-col items-center rounded border border-[#22252a] bg-[#2a2d33] overflow-hidden shadow-inner"
                title="Cycle Limiter Character Mode (A / B / C)"
              >
                <span className="px-3.5 py-1 text-[13px] font-semibold text-white">
                  {modeLetters[limiterModeIdx] ?? 'B'}
                </span>
                <span className="px-2.5 py-0.5 text-[10.5px] font-medium bg-[#0b6ef6] text-white w-full text-center">
                  Mode
                </span>
              </button>
            </div>
          </div>

          {/* Envelope Panel */}
          <div className="bg-[#5a5c61] rounded border border-[#2d2f33] p-3 flex flex-col justify-between">
            <div className="text-[14px] font-normal text-[#d8dadf] mb-2">Envelope</div>
            <div className="flex items-center justify-around gap-3 pb-1">
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11.5px] text-[#d4d6db]">Attack</span>
                <div className="flex flex-col rounded border border-[#22252a] bg-[#2a2d33] overflow-hidden w-16">
                  {['Fast', 'Normal', 'Slow'].map((lbl, idx) => (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => setParam('attackMode', idx)}
                      className={`py-0.5 text-[10.5px] font-medium border-b last:border-b-0 border-[#1b1d21] transition-colors ${
                        attackMode === idx
                          ? 'bg-[#0b6ef6] text-white'
                          : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[11.5px] text-[#d4d6db]">Release</span>
                <RotaryKnob
                  value={release}
                  min={10}
                  max={1000}
                  defaultValue={180.0}
                  size={50}
                  neonColor="#2196f3"
                  label="Release"
                  onChange={(v) => setParam('release', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">{release.toFixed(1)} ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
