import React, { useRef, useState } from 'react';
import {
  Edit3,
  Play,
  RotateCcw,
  Sliders,
  Sparkles,
  Square,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { SpecialEffectPad, SpecialEffectPreset } from '../types/mixer';

export const SPECIAL_EFFECT_PRESETS: { value: SpecialEffectPreset; label: string }[] = [
  { value: 'airhorn', label: 'Airhorn' },
  { value: 'applause', label: 'Applause / Crowd' },
  { value: 'laser', label: 'Laser Sweep' },
  { value: 'riser', label: 'FX Riser' },
  { value: 'subdrop', label: 'Sub Drop' },
  { value: 'vinyl-stop', label: 'Vinyl Stop' },
  { value: 'siren', label: 'Siren' },
  { value: 'drumroll', label: 'Drumroll / Rimshot' },
  { value: 'bell', label: 'Ding Bell' },
  { value: 'whoosh', label: 'Whoosh Sweep' },
  { value: 'glitch', label: 'Digital Glitch' },
  { value: 'boom', label: 'Cinematic Boom' },
  { value: 'chime', label: 'Sparkle Chime' },
  { value: 'buzzer', label: 'Game Buzzer' },
  { value: 'scratch', label: 'DJ Scratch' },
  { value: 'laugh', label: 'Crowd Laugh' },
  { value: 'echo-hit', label: 'Echo Hit' },
  { value: 'fanfare', label: 'Brass Fanfare' },
  { value: 'robot', label: 'Robot Talk' },
  { value: 'clap', label: 'Hand Clap' },
  { value: 'cowbell', label: '808 Cowbell' },
  { value: 'crash', label: 'Cymbal Crash' },
  { value: 'sweep-down', label: 'Down Sweep' },
  { value: 'alarm', label: 'Alert Klaxon' },
  { value: 'boing', label: 'Spring Boing' },
  { value: 'coin', label: 'Arcade Coin' },
  { value: 'zap', label: 'Electro Zap' },
  { value: 'gong', label: 'Deep Gong' },
  { value: 'powerup', label: 'Power Up' },
  { value: 'custom', label: 'Custom Tone / File' },
];

interface SpecialEffectPanelProps {
  pads: SpecialEffectPad[];
  channelName: string;
  pluginEnabled: boolean;
  onTriggerPad: (pad: SpecialEffectPad) => void;
  onUpdatePad: (padId: string, updater: (prev: SpecialEffectPad) => SpecialEffectPad) => void;
  onResetPad: (padId: string) => void;
  onUploadAudio: (padId: string, file: File) => void;
  onClearAudio: (padId: string) => void;
  onStopAll: () => void;
  onOpenPlugin: () => void;
}

export const SpecialEffectPanel: React.FC<SpecialEffectPanelProps> = ({
  pads,
  channelName,
  pluginEnabled,
  onTriggerPad,
  onUpdatePad,
  onResetPad,
  onUploadAudio,
  onClearAudio,
  onStopAll,
  onOpenPlugin,
}) => {
  const [editMode, setEditMode] = useState(false);
  const [editingPadId, setEditingPadId] = useState<string | null>(null);
  const [activePadIds, setActivePadIds] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const editingPad = editingPadId ? pads.find((p) => p.id === editingPadId) ?? null : null;

  const firePad = (pad: SpecialEffectPad) => {
    onTriggerPad(pad);
    setActivePadIds((prev) => ({ ...prev, [pad.id]: true }));
    window.setTimeout(() => {
      setActivePadIds((prev) => {
        if (!prev[pad.id]) return prev;
        const next = { ...prev };
        delete next[pad.id];
        return next;
      });
    }, Math.min(900, Math.max(220, pad.durationMs * 0.55)));
  };

  const handlePadClick = (pad: SpecialEffectPad) => {
    if (editMode) {
      setEditingPadId(pad.id);
      return;
    }
    firePad(pad);
  };

  return (
    <aside className="w-[272px] lg:w-[296px] xl:w-[330px] shrink-0 h-full border-l-2 border-[#1e2738] bg-[#0a0e16] flex flex-col select-none">
      {/* Top Neon Bar matching theme color */}
      <div
        className="h-[5px] w-full shrink-0"
        style={{
          backgroundColor: 'var(--theme-neon)',
          boxShadow: '0 0 10px rgba(var(--theme-neon-rgb), 0.65)',
        }}
      />

      {/* Compact Panel Header */}
      <div className="px-2.5 py-1.5 border-b border-[#1c2331] bg-[#0f1420] flex items-center justify-between gap-1.5 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[var(--theme-neon)] shrink-0" />
            <span className="text-[11.5px] font-bold tracking-wider text-[var(--theme-neon-soft)] truncate">
              {channelName || 'SPECIAL EFF'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-[9.5px] text-slate-400">
            <span className="font-mono-tabular text-[rgba(var(--theme-neon-rgb),0.9)]">
              CH 7 · {pads.length} PADS
            </span>
            <span
              className={`px-1 rounded text-[8.5px] font-semibold border ${
                pluginEnabled
                  ? 'border-[rgba(var(--theme-neon-rgb),0.45)] bg-[rgba(var(--theme-neon-rgb),0.1)] text-[var(--theme-neon-soft)]'
                  : 'border-white/10 bg-white/5 text-slate-500'
              }`}
            >
              {pluginEnabled ? 'FX ON' : 'BYPASS'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={editMode ? 'Selesai Edit Pad' : 'Edit Tombol Special Effect'}
            onClick={() => {
              const next = !editMode;
              setEditMode(next);
              if (next && !editingPadId && pads[0]) {
                setEditingPadId(pads[0].id);
              } else if (!next) {
                setEditingPadId(null);
              }
            }}
            className={`px-1.5 py-1 rounded text-[10px] font-semibold border flex items-center gap-1 transition-all ${
              editMode
                ? 'bg-[rgba(var(--theme-neon-rgb),0.25)] border-[var(--theme-neon)] text-[var(--theme-neon-soft)] shadow-[0_0_10px_rgba(var(--theme-neon-rgb),0.4)]'
                : 'bg-[#151c2a] border-white/10 text-slate-300 hover:border-[rgba(var(--theme-neon-rgb),0.6)] hover:text-[var(--theme-neon-soft)]'
            }`}
          >
            <Edit3 className="w-3 h-3" />
            <span>{editMode ? 'Done' : 'Edit'}</span>
          </button>

          <button
            type="button"
            title="Stop All Special Effects"
            onClick={onStopAll}
            className="p-1.5 rounded bg-[#151c2a] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-400/50 transition-colors"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>

          <button
            type="button"
            title="Buka Plugin Special Effect (Ch 7)"
            onClick={onOpenPlugin}
            className="p-1.5 rounded bg-[#151c2a] border border-[rgba(var(--theme-neon-rgb),0.35)] text-[var(--theme-neon-soft)] hover:bg-[rgba(var(--theme-neon-rgb),0.2)] hover:border-[var(--theme-neon)] transition-colors"
          >
            <Sliders className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 30 Special Effect Pads (5 cols x 6 rows — auto-fits viewport height without scroll) */}
      <div
        className={`flex-1 min-h-0 p-2 ${
          editingPad ? 'overflow-y-auto console-scroll' : 'overflow-hidden'
        }`}
      >
        <div
          className={`grid grid-cols-5 gap-1.5 ${
            editingPad ? 'auto-rows-[46px]' : 'h-full grid-rows-6'
          }`}
        >
          {pads.map((pad) => {
            const isActive = !!activePadIds[pad.id];
            const isEditing = editingPadId === pad.id;
            return (
              <div
                key={pad.id}
                className={`group relative rounded border transition-all overflow-hidden flex ${
                  isEditing
                    ? 'bg-[rgba(var(--theme-neon-rgb),0.2)] border-[var(--theme-neon)] shadow-[0_0_10px_rgba(var(--theme-neon-rgb),0.4)]'
                    : isActive
                    ? 'bg-[rgba(var(--theme-neon-rgb),0.3)] border-[var(--theme-neon-soft)] shadow-[0_0_12px_rgba(var(--theme-neon-rgb),0.65)] scale-[0.97]'
                    : 'bg-[#121826] border-[rgba(var(--theme-neon-rgb),0.25)] hover:border-[rgba(var(--theme-neon-rgb),0.75)] hover:bg-[#1a1f28]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handlePadClick(pad)}
                  title={`${pad.index}. ${pad.label || `FX ${pad.index}`} (${pad.audioFileName || pad.preset})`}
                  className="w-full h-full px-1.5 py-1 flex flex-col justify-between text-left min-w-0"
                >
                  <div className="w-full flex items-center justify-between gap-0.5">
                    <span className="text-[8.5px] font-mono-tabular font-bold text-[rgba(var(--theme-neon-rgb),0.9)] leading-none">
                      {String(pad.index).padStart(2, '0')}
                    </span>
                    {pad.audioFileName ? (
                      <Volume2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                    ) : (
                      <span
                        className={`w-1.5 h-1.5 rounded-full transition-colors ${
                          isActive
                            ? 'bg-[var(--theme-neon-soft)] shadow-[0_0_6px_var(--theme-neon)]'
                            : 'bg-[rgba(var(--theme-neon-rgb),0.55)]'
                        }`}
                      />
                    )}
                  </div>

                  <div className="w-full min-w-0">
                    <div className="text-[9.5px] font-semibold text-slate-100 leading-tight truncate">
                      {pad.label || `FX ${pad.index}`}
                    </div>
                    {!editingPad && (
                      <div className="text-[8px] text-slate-400/90 truncate leading-tight">
                        {pad.audioFileName ? pad.audioFileName : pad.preset}
                      </div>
                    )}
                  </div>
                </button>

                {/* Quick Edit Icon per Pad */}
                {!editMode && (
                  <button
                    type="button"
                    title={`Edit Pad ${pad.index}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditMode(true);
                      setEditingPadId(pad.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 absolute top-0.5 right-0.5 p-0.5 rounded bg-black/80 text-slate-300 hover:text-[var(--theme-neon)] transition-opacity"
                  >
                    <Edit3 className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Inline Pad Editor Drawer */}
      {editingPad && (
        <div className="shrink-0 border-t border-[rgba(var(--theme-neon-rgb),0.4)] bg-[#0e1420] p-2 space-y-1.5 shadow-[0_-10px_24px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-[rgba(var(--theme-neon-rgb),0.2)] border border-[rgba(var(--theme-neon-rgb),0.55)] text-[9.5px] font-mono-tabular font-bold text-[var(--theme-neon-soft)]">
                PAD {String(editingPad.index).padStart(2, '0')}
              </span>
              <span className="text-[10.5px] font-semibold text-slate-200">Edit Effect</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Test Pad"
                onClick={() => firePad(editingPad)}
                className="px-2 py-0.5 rounded bg-[rgba(var(--theme-neon-rgb),0.2)] hover:bg-[rgba(var(--theme-neon-rgb),0.3)] border border-[rgba(var(--theme-neon-rgb),0.65)] text-[var(--theme-neon-soft)] text-[9.5px] font-semibold flex items-center gap-1"
              >
                <Play className="w-2.5 h-2.5 fill-current" />
                Test
              </button>
              <button
                type="button"
                title="Reset Pad ke Default"
                onClick={() => onResetPad(editingPad.id)}
                className="p-1 rounded bg-[#151d2c] hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <button
                type="button"
                title="Tutup Editor"
                onClick={() => {
                  setEditingPadId(null);
                  setEditMode(false);
                }}
                className="p-1 rounded bg-[#151d2c] hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="block text-[9px] text-slate-400 mb-0.5">Nama Tombol</label>
              <input
                type="text"
                maxLength={18}
                value={editingPad.label}
                onChange={(e) =>
                  onUpdatePad(editingPad.id, (p) => ({ ...p, label: e.target.value }))
                }
                placeholder={`FX ${editingPad.index}`}
                className="w-full h-6.5 px-2 rounded bg-[#080b12] border border-white/15 focus:border-[var(--theme-neon)] outline-none text-[10.5px] text-white"
              />
            </div>

            <div>
              <label className="block text-[9px] text-slate-400 mb-0.5">Preset Suara</label>
              <select
                value={editingPad.preset}
                onChange={(e) =>
                  onUpdatePad(editingPad.id, (p) => ({
                    ...p,
                    preset: e.target.value as SpecialEffectPreset,
                  }))
                }
                className="w-full h-6.5 px-1.5 rounded bg-[#080b12] border border-white/15 focus:border-[var(--theme-neon)] outline-none text-[10.5px] text-[var(--theme-neon-soft)]"
              >
                {SPECIAL_EFFECT_PRESETS.map((pr) => (
                  <option key={pr.value} value={pr.value}>
                    {pr.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="flex justify-between text-[8.5px] text-slate-400 mb-0.5">
                <span>Pitch</span>
                <span className="font-mono-tabular text-[var(--theme-neon-soft)]">
                  {editingPad.pitchSemitones > 0
                    ? `+${editingPad.pitchSemitones}`
                    : editingPad.pitchSemitones}{' '}
                  st
                </span>
              </div>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={editingPad.pitchSemitones}
                onChange={(e) =>
                  onUpdatePad(editingPad.id, (p) => ({
                    ...p,
                    pitchSemitones: Number(e.target.value),
                  }))
                }
                className="w-full h-1 bg-[#080b12] rounded-full accent-[var(--theme-neon)] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[8.5px] text-slate-400 mb-0.5">
                <span>Durasi</span>
                <span className="font-mono-tabular text-[var(--theme-neon-soft)]">
                  {(editingPad.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
              <input
                type="range"
                min={150}
                max={4000}
                step={50}
                value={editingPad.durationMs}
                onChange={(e) =>
                  onUpdatePad(editingPad.id, (p) => ({
                    ...p,
                    durationMs: Number(e.target.value),
                  }))
                }
                className="w-full h-1 bg-[#080b12] rounded-full accent-[var(--theme-neon)] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[8.5px] text-slate-400 mb-0.5">
                <span>Level</span>
                <span className="font-mono-tabular text-[var(--theme-neon-soft)]">
                  {editingPad.volumeDb > 0 ? `+${editingPad.volumeDb}` : editingPad.volumeDb} dB
                </span>
              </div>
              <input
                type="range"
                min={-24}
                max={6}
                step={1}
                value={editingPad.volumeDb}
                onChange={(e) =>
                  onUpdatePad(editingPad.id, (p) => ({
                    ...p,
                    volumeDb: Number(e.target.value),
                  }))
                }
                className="w-full h-1 bg-[#080b12] rounded-full accent-[var(--theme-neon)] cursor-pointer"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 h-6.5 px-2 rounded bg-[#141c2b] hover:bg-[rgba(var(--theme-neon-rgb),0.15)] border border-dashed border-[rgba(var(--theme-neon-rgb),0.45)] text-[9.5px] text-[var(--theme-neon-soft)] flex items-center justify-center gap-1.5 truncate"
            >
              <Upload className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {editingPad.audioFileName
                  ? editingPad.audioFileName
                  : 'Upload Audio (.wav / .mp3)'}
              </span>
            </button>
            {editingPad.audioFileName && (
              <button
                type="button"
                title="Hapus Custom Audio"
                onClick={() => onClearAudio(editingPad.id)}
                className="h-6.5 px-2 rounded bg-[#1a1622] hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[9.5px]"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onUploadAudio(editingPad.id, file);
                }
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}
    </aside>
  );
};
