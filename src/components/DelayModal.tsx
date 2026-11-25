import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, Power, Unlock, X } from 'lucide-react';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface DelayModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

const BEAT_DIVISIONS = [
  { label: '1/16', mult: 0.25 },
  { label: '1/8T', mult: 0.333 },
  { label: '1/8', mult: 0.5 },
  { label: '1/8D', mult: 0.75 },
  { label: '1/4', mult: 1.0 },
  { label: '1/4D', mult: 1.5 },
  { label: '1/2', mult: 2.0 },
  { label: '1/1', mult: 4.0 },
];

const PONG_FACTORS = ['Half', 'Triolic', 'Same', 'Dotted', 'Double'] as const;

const DELAY_PRESETS = [
  {
    name: 'default*',
    beatsIdx: 4,
    offset: 0.0,
    feedback: 17.0,
    pingPong: 2,
    width: 100.0,
    crossDelay: 0,
    inPan: 0,
    pongFactor: 3,
    lowCut: 140,
    hiCut: 4470,
    mix: 100.0,
  },
  {
    name: 'Vocal 1/4 Dotted',
    beatsIdx: 5,
    offset: 4.0,
    feedback: 28.0,
    pingPong: 2,
    width: 120.0,
    crossDelay: 18,
    inPan: 0,
    pongFactor: 3,
    lowCut: 220,
    hiCut: 3600,
    mix: 45.0,
  },
  {
    name: 'Slapback Studio',
    beatsIdx: 0,
    offset: -12.0,
    feedback: 8.0,
    pingPong: 0,
    width: 75.0,
    crossDelay: 0,
    inPan: 0,
    pongFactor: 2,
    lowCut: 180,
    hiCut: 5200,
    mix: 65.0,
  },
  {
    name: 'Ambient Dub Echo',
    beatsIdx: 2,
    offset: 6.5,
    feedback: 54.0,
    pingPong: 2,
    width: 150.0,
    crossDelay: 35,
    inPan: -15,
    pongFactor: 4,
    lowCut: 260,
    hiCut: 2800,
    mix: 80.0,
  },
];

function formatPan(v: number): string {
  if (Math.abs(v) < 1) return '<C>';
  return v < 0 ? `<${Math.round(Math.abs(v))}L` : `${Math.round(v)}R>`;
}

function formatHzShort(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} k`;
  return `${Math.round(hz)} Hz`;
}

export const DelayModal: React.FC<DelayModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const [presetIdx, setPresetIdx] = useState(0);
  const [mixLocked, setMixLocked] = useState(false);

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  const beatsIdx = Math.max(0, Math.min(BEAT_DIVISIONS.length - 1, Math.round(getVal('beatsIdx', 4))));
  const offset = getVal('offset', 0.0);
  const feedback = getVal('feedback', 17.0);
  const pingPong = Math.round(getVal('pingPong', 2)); // 0: Off, 1: Sum, 2: 2-Ch
  const swap = getVal('swap', 0) === 1;
  const width = getVal('width', 100.0);
  const crossDelay = getVal('crossDelay', 0);
  const inPan = getVal('inPan', 0);
  const pongFactor = Math.round(getVal('pongFactor', 3)); // 0..4 (default Dotted = 3)
  const lowCut = getVal('lowCut', 140);
  const hiCut = getVal('hiCut', getVal('tone', 4470));
  const mix = getVal('mix', 100.0);

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => {
      const next = { ...prev.params, [key]: val };
      const bIdx = Math.max(0, Math.min(BEAT_DIVISIONS.length - 1, Math.round(next.beatsIdx ?? 4)));
      const beatMs = BEAT_DIVISIONS[bIdx].mult * 500;
      next.timeMs = Math.max(20, Math.min(1800, beatMs + (next.offset ?? 0)));
      if (key === 'hiCut') {
        next.tone = val;
      }
      return { ...prev, params: next };
    });
  };

  const applyPreset = (idx: number) => {
    const safeIdx = ((idx % DELAY_PRESETS.length) + DELAY_PRESETS.length) % DELAY_PRESETS.length;
    setPresetIdx(safeIdx);
    const pr = DELAY_PRESETS[safeIdx];
    const beatMs = BEAT_DIVISIONS[pr.beatsIdx].mult * 500;
    onUpdatePlugin(channel.id, plugin.id, (prev) => ({
      ...prev,
      params: {
        ...prev.params,
        beatsIdx: pr.beatsIdx,
        offset: pr.offset,
        feedback: pr.feedback,
        pingPong: pr.pingPong,
        width: pr.width,
        crossDelay: pr.crossDelay,
        inPan: pr.inPan,
        pongFactor: pr.pongFactor,
        lowCut: pr.lowCut,
        hiCut: pr.hiCut,
        tone: pr.hiCut,
        timeMs: Math.max(20, beatMs + pr.offset),
        ...(mixLocked ? {} : { mix: pr.mix }),
      },
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[920px] rounded-md bg-[#222326] border border-black shadow-[0_28px_90px_rgba(0,0,0,0.92)] overflow-hidden select-none text-slate-200"
      >
        {/* Top Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#1b1c1f] border-b border-black">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1.5 rounded border transition-all ${
                plugin.enabled
                  ? 'bg-[#0b6ef6]/25 text-[#38bdf8] border-[#1f84ff]/70 shadow-[0_0_8px_rgba(56,189,248,0.4)]'
                  : 'bg-[#2a2d33] text-slate-500 border-black'
              }`}
              title="Enable / Bypass Delay"
            >
              <Power className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center bg-[#121316] border border-black/80 rounded overflow-hidden">
              <button
                type="button"
                onClick={() => applyPreset(presetIdx - 1)}
                className="p-1 text-slate-400 hover:text-white hover:bg-white/5 border-r border-black/60"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => applyPreset(presetIdx + 1)}
                className="p-1 text-slate-400 hover:text-white hover:bg-white/5 border-r border-black/60"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <select
                value={presetIdx}
                onChange={(e) => applyPreset(Number(e.target.value))}
                className="bg-transparent px-4 py-0.5 text-[11.5px] text-white focus:outline-none cursor-pointer"
              >
                {DELAY_PRESETS.map((pr, idx) => (
                  <option key={pr.name} value={idx} className="bg-[#18191c] text-white">
                    {pr.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-black/40 text-emerald-300 border border-white/10">
              {plugin.format}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400">
              Ch: <strong style={{ color: channel.neonAccent }}>{channel.name || `Ch ${channel.index}`}</strong>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main 4-Section Grey Faceplate (Beat Delay | Modulation | Color | Global) */}
        <div className="grid grid-cols-[1.25fr_2.05fr_0.95fr_0.65fr] gap-1.5 p-1.5 bg-[#1b1c1f]">
          {/* Section 1: Beat Delay */}
          <div className="bg-[#5b5d62] rounded border border-[#2f3136] p-3 flex flex-col justify-between min-h-[175px]">
            <div className="text-[18px] font-normal tracking-tight text-[#d8dadf]">
              Beat Delay
            </div>

            <div className="flex items-end justify-around gap-2 pt-2">
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11.5px] text-[#d4d6db]">Beats</span>
                <RotaryKnob
                  value={beatsIdx}
                  min={0}
                  max={BEAT_DIVISIONS.length - 1}
                  defaultValue={4}
                  size={48}
                  neonColor="#4ade80"
                  label="Beats"
                  onChange={(v) => setParam('beatsIdx', Math.round(v))}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {BEAT_DIVISIONS[beatsIdx].label}
                </span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11.5px] text-[#d4d6db]">Offset</span>
                <RotaryKnob
                  value={offset}
                  min={-50}
                  max={50}
                  defaultValue={0}
                  size={36}
                  neonColor="#4ade80"
                  label="Offset"
                  onChange={(v) => setParam('offset', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {offset.toFixed(2)} ms
                </span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11.5px] text-[#d4d6db]">Feedback</span>
                <RotaryKnob
                  value={feedback}
                  min={0}
                  max={95}
                  defaultValue={17}
                  size={48}
                  neonColor="#4ade80"
                  label="Feedback"
                  onChange={(v) => setParam('feedback', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {feedback.toFixed(2)} %
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Modulation */}
          <div className="bg-[#5b5d62] rounded border border-[#2f3136] p-3 flex flex-col justify-between min-h-[175px]">
            <div className="text-[16px] font-normal text-[#d8dadf]">Modulation</div>

            <div className="flex items-center justify-around gap-2 pt-1">
              {/* Ping-Pong + Swap */}
              <div className="flex flex-col items-center gap-2">
                <span className="text-[11px] text-[#d4d6db]">Ping-Pong</span>
                <div className="flex flex-col rounded border border-[#222428] bg-[#36383d] overflow-hidden w-14">
                  {['Off', 'Sum', '2-Ch'].map((lbl, idx) => (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => setParam('pingPong', idx)}
                      className={`py-0.5 text-[10.5px] font-medium border-b last:border-b-0 border-[#222428] transition-colors ${
                        pingPong === idx
                          ? 'bg-[#0b6ef6] text-white'
                          : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setParam('swap', swap ? 0 : 1)}
                  className={`px-3 py-0.5 rounded text-[10.5px] border transition-colors ${
                    swap
                      ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                      : 'bg-[#36383d] text-slate-200 border-[#222428]'
                  }`}
                >
                  Swap
                </button>
              </div>

              {/* Width */}
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11px] text-[#d4d6db]">Width</span>
                <RotaryKnob
                  value={width}
                  min={0}
                  max={200}
                  defaultValue={100}
                  size={48}
                  neonColor="#4ade80"
                  label="Stereo Width"
                  onChange={(v) => setParam('width', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {width.toFixed(2)} %
                </span>
              </div>

              {/* Cross Delay */}
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11px] text-[#d4d6db] whitespace-nowrap">Cross Delay</span>
                <RotaryKnob
                  value={crossDelay}
                  min={0}
                  max={100}
                  defaultValue={0}
                  size={44}
                  neonColor="#4ade80"
                  label="Cross Delay"
                  onChange={(v) => setParam('crossDelay', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {crossDelay <= 0.5 ? 'off' : `${crossDelay.toFixed(0)} %`}
                </span>
              </div>

              {/* In Pan */}
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11px] text-[#d4d6db]">In Pan</span>
                <RotaryKnob
                  value={inPan}
                  min={-100}
                  max={100}
                  defaultValue={0}
                  size={36}
                  neonColor="#4ade80"
                  label="In Pan"
                  onChange={(v) => setParam('inPan', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {formatPan(inPan)}
                </span>
              </div>

              {/* Pong-Factor */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-[#d4d6db] whitespace-nowrap">Pong-Factor</span>
                <div className="flex flex-col rounded border border-[#222428] bg-[#36383d] overflow-hidden w-16">
                  {PONG_FACTORS.map((lbl, idx) => (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => setParam('pongFactor', idx)}
                      className={`py-0.5 text-[10px] font-medium border-b last:border-b-0 border-[#222428] transition-colors ${
                        pongFactor === idx
                          ? 'bg-[#0b6ef6] text-white'
                          : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Color */}
          <div className="bg-[#5b5d62] rounded border border-[#2f3136] p-3 flex flex-col justify-between min-h-[175px]">
            <div className="text-[16px] font-normal text-[#d8dadf]">Color</div>

            <div className="flex items-end justify-around gap-2 pt-2">
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11px] text-[#d4d6db]">Low Cut</span>
                <RotaryKnob
                  value={lowCut}
                  min={20}
                  max={2000}
                  defaultValue={140}
                  size={40}
                  neonColor="#4ade80"
                  label="Low Cut"
                  onChange={(v) => setParam('lowCut', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {formatHzShort(lowCut)}
                </span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11px] text-[#d4d6db]">Hi Cut</span>
                <RotaryKnob
                  value={hiCut}
                  min={500}
                  max={20000}
                  defaultValue={4470}
                  size={40}
                  neonColor="#4ade80"
                  label="Hi Cut"
                  onChange={(v) => setParam('hiCut', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {formatHzShort(hiCut)}
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: Global */}
          <div className="bg-[#5b5d62] rounded border border-[#2f3136] p-3 flex flex-col justify-between items-center min-h-[175px]">
            <div className="text-[16px] font-normal text-[#d8dadf] self-start">Global</div>

            <div className="flex flex-col items-center gap-1.5 pt-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#d4d6db]">Mix</span>
                <button
                  type="button"
                  onClick={() => setMixLocked((v) => !v)}
                  className={`p-1 rounded border transition-colors ${
                    mixLocked
                      ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                      : 'bg-[#36383d] text-slate-300 border-[#222428]'
                  }`}
                  title="Lock Mix across presets"
                >
                  {mixLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                </button>
              </div>
              <RotaryKnob
                value={mix}
                min={0}
                max={100}
                defaultValue={100}
                size={52}
                neonColor="#4ade80"
                label="Wet/Dry Mix"
                onChange={(v) => setParam('mix', v)}
              />
              <span className="text-[11px] font-mono-tabular text-white">
                {mix.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
