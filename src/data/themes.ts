import { ThemePreset, ThemePresetId } from '../types/mixer';

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'neon-yellow',
    name: 'Neon Yellow',
    description: 'Kuning neon kontras tinggi untuk konsol studio gelap',
    neon: '#eaff00',
    neonSoft: '#f7ff6b',
    neonRgb: '234, 255, 0',
    tintBg: 'rgba(234, 255, 0, 0.08)',
    bgMain: '#080a0f',
    bgPanel: '#0b0e15',
    meterMid: '#facc15',
  },
  {
    id: 'cyber-cyan',
    name: 'Cyber Cyan',
    description: 'Biru cyan elektrik klasik DAW modern',
    neon: '#00e5ff',
    neonSoft: '#67f2ff',
    neonRgb: '0, 229, 255',
    tintBg: 'rgba(0, 229, 255, 0.09)',
    bgMain: '#070a10',
    bgPanel: '#0a0f18',
    meterMid: '#22d3ee',
  },
  {
    id: 'emerald-matrix',
    name: 'Emerald Green',
    description: 'Hijau neon segar dengan visibilitas meter tajam',
    neon: '#00ff9d',
    neonSoft: '#7affc8',
    neonRgb: '0, 255, 157',
    tintBg: 'rgba(0, 255, 157, 0.08)',
    bgMain: '#070b0a',
    bgPanel: '#0a110f',
    meterMid: '#34d399',
  },
  {
    id: 'plasma-magenta',
    name: 'Plasma Pink',
    description: 'Magenta neon futuristik untuk live performance',
    neon: '#ff38e8',
    neonSoft: '#ff8ef2',
    neonRgb: '255, 56, 232',
    tintBg: 'rgba(255, 56, 232, 0.09)',
    bgMain: '#0b080f',
    bgPanel: '#110b17',
    meterMid: '#f472b6',
  },
  {
    id: 'amber-gold',
    name: 'Amber Gold',
    description: 'Oranye keemasan hangat ala hardware analog',
    neon: '#ff9e00',
    neonSoft: '#ffc766',
    neonRgb: '255, 158, 0',
    tintBg: 'rgba(255, 158, 0, 0.09)',
    bgMain: '#0b0907',
    bgPanel: '#120e0b',
    meterMid: '#fbbf24',
  },
  {
    id: 'crimson-studio',
    name: 'Crimson Neon',
    description: 'Merah neon agresif dengan nuansa panggung gelap',
    neon: '#ff3b6b',
    neonSoft: '#ff8aa7',
    neonRgb: '255, 59, 107',
    tintBg: 'rgba(255, 59, 107, 0.09)',
    bgMain: '#0c080b',
    bgPanel: '#130b10',
    meterMid: '#fb7185',
  },
];

export function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [234, 255, 0];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function buildCustomTheme(hexColor: string): ThemePreset {
  const [r, g, b] = hexToRgbTuple(hexColor);
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.45));
  const softHex = `#${[mix(r), mix(g), mix(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
  const rgb = `${r}, ${g}, ${b}`;
  return {
    id: 'custom',
    name: 'Custom Neon',
    description: 'Warna neon pilihan kustom',
    neon: hexColor,
    neonSoft: softHex,
    neonRgb: rgb,
    tintBg: `rgba(${rgb}, 0.08)`,
    bgMain: '#080a0f',
    bgPanel: '#0b0e15',
    meterMid: softHex,
  };
}

export function resolveThemePreset(presetId: ThemePresetId, customHex?: string): ThemePreset {
  if (presetId === 'custom' && customHex) {
    return buildCustomTheme(customHex);
  }
  return THEME_PRESETS.find((t) => t.id === presetId) ?? THEME_PRESETS[0];
}

export function applyThemeToDocument(theme: ThemePreset): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--theme-neon', theme.neon);
  root.setProperty('--theme-neon-soft', theme.neonSoft);
  root.setProperty('--theme-neon-rgb', theme.neonRgb);
  root.setProperty('--theme-tint-bg', theme.tintBg);
  root.setProperty('--theme-bg-main', theme.bgMain);
  root.setProperty('--theme-bg-panel', theme.bgPanel);
  root.setProperty('--theme-meter-mid', theme.meterMid);
}
