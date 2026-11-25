import React, { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Lock, Power, Unlock, X } from 'lucide-react';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface ReverbModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

const REVERB_PRESETS: {
  name: string;
  preDelay: number;
  size: number;
  damping: number;
  width: number;
  mix: number;
}[] = [
  { name: 'Large Hall*', preDelay: 70.0, size: 80.0, damping: 0.0, width: 90.0, mix: 100 },
  { name: 'Vocal Plate', preDelay: 32.0, size: 58.0, damping: 24.0, width: 100.0, mix: 65 },
  { name: 'Studio Room', preDelay: 18.0, size: 36.0, damping: 42.0, width: 80.0, mix: 45 },
  { name: 'Cathedral', preDelay: 95.0, size: 96.0, damping: 12.0, width: 115.0, mix: 85 },
];

export const ReverbModal: React.FC<ReverbModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const [presetIdx, setPresetIdx] = useState(0);
  const [mixLocked, setMixLocked] = useState(true);

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  const preDelay = getVal('preDelay', 70.0);
  const size = getVal('size', 80.0);
  const damping = getVal('damping', 0.0);
  const gateOn = getVal('gateOn', 0) === 1;
  const gateThreshold = getVal('gateThreshold', -12.0);
  const gateRelease = getVal('gateRelease', 150.0);
  const width = getVal('width', 90.0);
  const mix = getVal('mix', 100);

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => {
      const nextParams = { ...prev.params, [key]: val };
      if (key === 'size') {
        nextParams.decay = Number((0.4 + (val / 100) * 4.6).toFixed(2));
      }
      return { ...prev, params: nextParams };
    });
  };

  const applyPreset = (idx: number) => {
    const safeIdx = ((idx % REVERB_PRESETS.length) + REVERB_PRESETS.length) % REVERB_PRESETS.length;
    setPresetIdx(safeIdx);
    const pr = REVERB_PRESETS[safeIdx];
    onUpdatePlugin(channel.id, plugin.id, (prev) => ({
      ...prev,
      params: {
        ...prev.params,
        preDelay: pr.preDelay,
        size: pr.size,
        decay: Number((0.4 + (pr.size / 100) * 4.6).toFixed(2)),
        damping: pr.damping,
        width: pr.width,
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
        className="w-full max-w-[740px] rounded-md bg-[#222326] border border-black shadow-[0_28px_90px_rgba(0,0,0,0.92)] overflow-hidden select-none text-slate-200"
      >
        {/* Top Channel Tab Strip (matching image 1) */}
        <div className="flex items-center justify-between px-2.5 py-1 bg-[#1b1c1f] border-b border-black/80 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">▼</span>
            <span className="text-slate-300 font-bold">+</span>
            <span className="font-semibold text-white tracking-wide">
              {channel.name || `CH ${channel.index}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-black/40 text-amber-300 border border-white/10">
              {plugin.format}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Insert Tab Bar */}
        <div className="flex items-center gap-1 px-2 pt-1 bg-[#141517] border-b border-black">
          <div className="px-3 py-1 rounded-t bg-[#26272b] border-t border-x border-[#3a3c42] text-[11.5px] font-medium text-white flex items-center gap-2">
            <span>1 - {plugin.name}</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </div>
          <div className="px-3 py-1 text-[11.5px] text-slate-400">2 - Equalizer</div>
        </div>

        {/* Preset & Power Toolbar */}
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
              title="Enable / Bypass Reverb"
            >
              <Power className="w-3.5 h-3.5" />
            </button>

            {/* Preset Switcher */}
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
                {REVERB_PRESETS.map((pr, idx) => (
                  <option key={pr.name} value={idx} className="bg-[#18191c] text-white">
                    {pr.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <span className="text-[10.5px] text-slate-400">
            Decay: <span className="font-mono-tabular text-amber-300">{(0.4 + (size / 100) * 4.6).toFixed(1)}s</span>
          </span>
        </div>

        {/* Main 3-Section Grey Faceplate (Mixverb | Gate | Global) */}
        <div className="grid grid-cols-[1.35fr_1.15fr_0.95fr] gap-1.5 p-1.5 bg-[#1b1c1f]">
          {/* Section 1: Mixverb */}
          <div className="bg-[#5b5d62] rounded border border-[#2f3136] p-3 flex flex-col justify-between min-h-[175px]">
            <div className="flex items-center gap-2.5">
              <span className="text-[18px] font-normal tracking-tight text-[#d8dadf]">
                Mixverb
              </span>
            </div>

            <div className="flex items-end justify-around gap-2 pt-2">
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11.5px] text-[#d4d6db]">Pre-delay</span>
                <RotaryKnob
                  value={preDelay}
                  min={0}
                  max={250}
                  defaultValue={70.0}
                  size={44}
                  neonColor="#eab308"
                  label="Pre-delay"
                  onChange={(v) => setParam('preDelay', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {preDelay.toFixed(1)} ms
                </span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11.5px] text-[#d4d6db]">Size</span>
                <RotaryKnob
                  value={size}
                  min={0}
                  max={100}
                  defaultValue={80.0}
                  size={60}
                  neonColor="#facc15"
                  label="Room Size"
                  onChange={(v) => setParam('size', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {size.toFixed(1)} %
                </span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11.5px] text-[#d4d6db]">Damping</span>
                <RotaryKnob
                  value={damping}
                  min={0}
                  max={100}
                  defaultValue={0.0}
                  size={44}
                  neonColor="#eab308"
                  label="Damping"
                  onChange={(v) => setParam('damping', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {damping.toFixed(1)} %
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Gate */}
          <div className="bg-[#5b5d62] rounded border border-[#2f3136] p-3 flex flex-col justify-between min-h-[175px]">
            <div className="text-[16px] font-normal text-[#d8dadf]">Gate</div>

            <div className="flex items-center justify-around gap-2 pt-2">
              <button
                type="button"
                onClick={() => setParam('gateOn', gateOn ? 0 : 1)}
                className={`px-4 py-2 rounded border transition-all ${
                  gateOn
                    ? 'bg-[#0b6ef6] text-white border-[#3b9bff] shadow-[0_0_8px_rgba(11,110,246,0.5)]'
                    : 'bg-[#3b3d42] text-slate-300 border-[#25272b] hover:bg-[#46484e]'
                }`}
                title="Enable Reverb Gate"
              >
                <Power className="w-4 h-4" />
              </button>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10.5px] text-[#d4d6db] text-center leading-tight">
                  Gate
                  <br />
                  Threshold
                </span>
                <RotaryKnob
                  value={gateThreshold}
                  min={-60}
                  max={0}
                  defaultValue={-12.0}
                  size={42}
                  neonColor={gateOn ? '#eab308' : '#64748b'}
                  label="Gate Threshold"
                  onChange={(v) => setParam('gateThreshold', v)}
                />
                <span className={`text-[10.5px] font-mono-tabular ${gateOn ? 'text-white' : 'text-slate-400'}`}>
                  {gateThreshold.toFixed(2)} dB
                </span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10.5px] text-[#d4d6db] text-center leading-tight">
                  Gate
                  <br />
                  Release
                </span>
                <RotaryKnob
                  value={gateRelease}
                  min={10}
                  max={1000}
                  defaultValue={150.0}
                  size={42}
                  neonColor={gateOn ? '#eab308' : '#64748b'}
                  label="Gate Release"
                  onChange={(v) => setParam('gateRelease', v)}
                />
                <span className={`text-[10.5px] font-mono-tabular ${gateOn ? 'text-white' : 'text-slate-400'}`}>
                  {gateRelease.toFixed(1)} ms
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Global */}
          <div className="bg-[#5b5d62] rounded border border-[#2f3136] p-3 flex flex-col justify-between min-h-[175px]">
            <div className="text-[16px] font-normal text-[#d8dadf]">Global</div>

            <div className="flex items-end justify-around gap-2 pt-2">
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11.5px] text-[#d4d6db]">Width</span>
                <RotaryKnob
                  value={width}
                  min={0}
                  max={200}
                  defaultValue={90.0}
                  size={44}
                  neonColor="#eab308"
                  label="Stereo Width"
                  onChange={(v) => setParam('width', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
                  {width.toFixed(1)} %
                </span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11.5px] text-[#d4d6db]">Mix</span>
                  <button
                    type="button"
                    onClick={() => setMixLocked((v) => !v)}
                    className={`p-1 rounded border transition-colors ${
                      mixLocked
                        ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                        : 'bg-[#36383d] text-slate-300 border-[#222428]'
                    }`}
                    title="Lock Mix level across presets"
                  >
                    {mixLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  </button>
                </div>
                <RotaryKnob
                  value={mix}
                  min={0}
                  max={100}
                  defaultValue={100}
                  size={56}
                  neonColor="#eab308"
                  label="Wet/Dry Mix"
                  onChange={(v) => setParam('mix', v)}
                />
                <span className="text-[11px] font-mono-tabular text-white">
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
