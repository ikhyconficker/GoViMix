import React from 'react';
import { Check, Palette, RotateCcw, Sparkles, X } from 'lucide-react';
import { THEME_PRESETS } from '../data/themes';
import { ThemePreset, ThemePresetId } from '../types/mixer';

interface ThemeSettingsModalProps {
  activeTheme: ThemePreset;
  customHex: string;
  onSelectPreset: (presetId: ThemePresetId) => void;
  onSelectCustomColor: (hexColor: string) => void;
  onClose: () => void;
}

export const ThemeSettingsModal: React.FC<ThemeSettingsModalProps> = ({
  activeTheme,
  customHex,
  onSelectPreset,
  onSelectCustomColor,
  onClose,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[580px] rounded-lg bg-[#0d111a] border border-[rgba(var(--theme-neon-rgb),0.45)] shadow-[0_24px_80px_rgba(0,0,0,0.88)] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#121826] border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-[rgba(var(--theme-neon-rgb),0.15)] border border-[rgba(var(--theme-neon-rgb),0.45)] text-[var(--theme-neon)]">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">
                Pengaturan Tema &amp; Warna Neon
              </h2>
              <p className="text-[11px] text-slate-400">
                Pilih preset warna konsol mixer, fader, meter, dan tombol Special Effect
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSelectPreset('neon-yellow')}
              title="Kembalikan ke Neon Yellow"
              className="px-2 py-1 rounded bg-[#182030] hover:bg-white/10 border border-white/10 text-[10.5px] text-slate-300 flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Default
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Preset Grid */}
        <div className="p-4 space-y-4 bg-[#090c13]">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Preset Warna Studio
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {THEME_PRESETS.map((preset) => {
                const isSelected = activeTheme.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onSelectPreset(preset.id)}
                    className={`group relative rounded-md p-2.5 text-left border transition-all ${
                      isSelected
                        ? 'bg-[#131a29] border-white/60'
                        : 'bg-[#0e131e] border-white/10 hover:border-white/30 hover:bg-[#121928]'
                    }`}
                    style={
                      isSelected
                        ? {
                            borderColor: preset.neon,
                            boxShadow: `0 0 16px rgba(${preset.neonRgb}, 0.28)`,
                          }
                        : undefined
                    }
                  >
                    {/* Mini Console Preview Strip */}
                    <div
                      className="h-11 rounded border border-white/10 mb-2 p-1.5 flex items-center justify-between overflow-hidden"
                      style={{ backgroundColor: preset.bgMain }}
                    >
                      <div className="flex items-center gap-1.5 h-full">
                        {/* Mini Strip Bar + Fader */}
                        <div className="w-2.5 h-full rounded-[2px] bg-[#141a26] relative overflow-hidden">
                          <div
                            className="absolute bottom-0 left-0 right-0 h-[72%]"
                            style={{
                              backgroundColor: preset.neon,
                              boxShadow: `0 0 8px ${preset.neon}`,
                            }}
                          />
                        </div>
                        <div className="w-1.5 h-full rounded-[1px] bg-[#141a26] relative overflow-hidden">
                          <div
                            className="absolute bottom-0 left-0 right-0 h-[55%]"
                            style={{ backgroundColor: preset.meterMid }}
                          />
                        </div>
                      </div>

                      {/* Mini Pads Preview */}
                      <div className="grid grid-cols-2 gap-1">
                        {[0, 1, 2, 3].map((idx) => (
                          <span
                            key={idx}
                            className="w-3 h-2.5 rounded-[2px] border"
                            style={{
                              backgroundColor:
                                idx === 0 ? `rgba(${preset.neonRgb}, 0.3)` : '#131926',
                              borderColor:
                                idx === 0 ? preset.neon : `rgba(${preset.neonRgb}, 0.35)`,
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-white truncate">{preset.name}</span>
                      {isSelected ? (
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center text-slate-950 shrink-0"
                          style={{ backgroundColor: preset.neon }}
                        >
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                      ) : (
                        <span
                          className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                          style={{ backgroundColor: preset.neon }}
                        />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug mt-0.5 line-clamp-2">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Color Picker */}
          <div className="rounded-md border border-white/10 bg-[#0d121c] p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Sparkles className="w-4 h-4 text-[var(--theme-neon)] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white">Warna Neon Kustom</div>
                <div className="text-[10.5px] text-slate-400 truncate">
                  Pilih warna bebas sesuai selera setup studio Anda
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-mono-tabular uppercase text-[var(--theme-neon-soft)] bg-[#080b11] px-2 py-1 rounded border border-white/10">
                {activeTheme.id === 'custom' ? customHex : activeTheme.neon}
              </span>
              <label
                title="Pilih Warna Neon Kustom"
                className="relative cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#161e2e] hover:bg-[#1e293d] border border-[rgba(var(--theme-neon-rgb),0.45)] text-[11px] font-semibold text-white transition-colors"
              >
                <span
                  className="w-3.5 h-3.5 rounded-sm border border-white/30"
                  style={{ backgroundColor: customHex }}
                />
                <span>Pilih</span>
                <input
                  type="color"
                  value={customHex}
                  onChange={(e) => onSelectCustomColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
