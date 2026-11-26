import React, { useEffect, useRef, useState } from 'react';
import { Power, Snowflake, X } from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface EqualizerModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

type BandId = 'lf' | 'lmf' | 'mf' | 'hmf' | 'hf';

const BAND_COLORS: Record<BandId | 'lc' | 'hc', string> = {
  lc: '#94a3b8',
  lf: '#fb923c',
  lmf: '#facc15',
  mf: '#4ade80',
  hmf: '#10b981',
  hf: '#38bdf8',
  hc: '#a78bfa',
};

const BAND_DEFAULTS: Record<BandId, { freq: number; gain: number; q: number }> = {
  lf: { freq: 65, gain: 2.0, q: 1.4 },
  lmf: { freq: 240, gain: 0.0, q: 1.8 },
  mf: { freq: 1000, gain: 1.5, q: 1.4 },
  hmf: { freq: 4200, gain: 0.0, q: 2.2 },
  hf: { freq: 8500, gain: 1.5, q: 1.0 },
};

function formatFreq(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} k`;
  return `${hz.toFixed(1)} Hz`;
}

function freqToNorm(freq: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.max(0, Math.min(1, (Math.log10(Math.max(20, freq)) - minLog) / (maxLog - minLog)));
}

function normToFreq(norm: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.pow(10, minLog + Math.max(0, Math.min(1, norm)) * (maxLog - minLog));
}

export const EqualizerModal: React.FC<EqualizerModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingBandRef = useRef<BandId | 'lc' | 'hc' | null>(null);
  const frozenFftRef = useRef<Uint8Array | null>(null);

  const [bandControlsOpen, setBandControlsOpen] = useState(true);
  const [dynamicsVisible, setDynamicsVisible] = useState(true);
  const [showCurves, setShowCurves] = useState(true);
  const [highQuality, setHighQuality] = useState(true);
  const [freezeSpectrum, setFreezeSpectrum] = useState(false);
  const [levelRangeDb, setLevelRangeDb] = useState<6 | 12 | 24>(24);
  const [analyzerMode, setAnalyzerMode] = useState<'12th Octave' | '3rd Octave' | 'FFT'>('12th Octave');

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => {
      const nextParams = { ...prev.params, [key]: val };
      // Keep core AudioEngine BiquadFilter keys synced
      nextParams.lowCut = nextParams.lc_on === 1 ? nextParams.lc_freq ?? 60 : 20;
      nextParams.lowGain = nextParams.lf_on !== 0 ? nextParams.lf_gain ?? 0 : 0;
      nextParams.midFreq = nextParams.mf_freq ?? 1000;
      nextParams.midGain = nextParams.mf_on !== 0 ? nextParams.mf_gain ?? 0 : 0;
      nextParams.highGain = nextParams.hf_on !== 0 ? nextParams.hf_gain ?? 0 : 0;
      return { ...prev, params: nextParams };
    });
  };

  // Band helper getters
  const getBand = (id: BandId) => ({
    on: getVal(`${id}_on`, 1) === 1,
    dyn: getVal(`${id}_dyn`, 0) === 1,
    solo: getVal(`${id}_solo`, 0) === 1,
    freq: getVal(`${id}_freq`, BAND_DEFAULTS[id].freq),
    gain: getVal(`${id}_gain`, BAND_DEFAULTS[id].gain),
    q: getVal(`${id}_q`, BAND_DEFAULTS[id].q),
    thrs: getVal(`${id}_thrs`, 0),
    range: getVal(`${id}_range`, 0),
    shape: getVal(`${id}_shape`, id === 'hf' ? 1 : 0), // 0 = Peaking, 1 = Shelf 6dB, 2 = Shelf 12dB
  });

  const lcOn = getVal('lc_on', 1) === 1;
  const lcFreq = getVal('lc_freq', getVal('lowCut', 60));
  const lcSlope = getVal('lc_slope', 12);

  const hcOn = getVal('hc_on', 1) === 1;
  const hcFreq = getVal('hc_freq', 18000);
  const hcSlope = getVal('hc_slope', 12);

  const llcOn = getVal('llc_on', 0) === 1;
  const llcHz = getVal('llc_hz', 50);
  const llcSoft = getVal('llc_soft', 0) === 1;

  const outGain = getVal('out_gain', 0);
  const autoGain = getVal('auto_gain', 0) === 1;

  // Evaluate single band contribution in dB at frequency f
  const evalBandDb = (id: BandId, f: number): number => {
    const b = getBand(id);
    if (!b.on) return 0;
    if (b.shape === 1 || b.shape === 2) {
      // Shelf
      const slopeFactor = b.shape === 2 ? 2.4 : 1.4;
      const ratio = id === 'lf' ? b.freq / Math.max(20, f) : f / Math.max(20, b.freq);
      const sig = 1 / (1 + Math.pow(1 / Math.max(0.05, ratio), slopeFactor));
      return b.gain * sig;
    }
    // Peaking bell
    const distOct = Math.log2(f / Math.max(20, b.freq));
    const width = 1.6 / Math.max(0.25, b.q);
    return b.gain * Math.exp(-(distOct * distOct) / (width * width));
  };

  const evalCutDb = (f: number): number => {
    let cut = 0;
    if (lcOn && f < lcFreq) {
      cut -= (lcSlope / 6) * 6 * Math.log2(lcFreq / Math.max(20, f));
    }
    if (llcOn && f < llcHz) {
      cut -= (llcSoft ? 4 : 8) * Math.log2(llcHz / Math.max(20, f));
    }
    if (hcOn && f > hcFreq) {
      cut -= (hcSlope / 6) * 6 * Math.log2(f / Math.max(20, hcFreq));
    }
    return cut;
  };

  // Render EQ Graph + Spectrum + Piano Keyboard Strip
  useEffect(() => {
    let raf = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const graphH = h - 24; // reserve 24px bottom for piano keys & freq labels
          const midY = graphH / 2;

          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#06090f';
          ctx.fillRect(0, 0, w, h);

          // Vertical Frequency Grid Lines
          const freqMarks = [
            { f: 50, l: '50 Hz' },
            { f: 100, l: '100 Hz' },
            { f: 200, l: '200 Hz' },
            { f: 500, l: '500 Hz' },
            { f: 1000, l: '1 kHz' },
            { f: 2000, l: '2 kHz' },
            { f: 5000, l: '5 kHz' },
            { f: 10000, l: '10 kHz' },
          ];
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
          ctx.lineWidth = 1;
          freqMarks.forEach((m) => {
            const x = freqToNorm(m.f) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, graphH);
            ctx.stroke();
          });

          // Horizontal dB Grid Lines
          const dbSteps = [-3, -2, -1, 0, 1, 2, 3];
          dbSteps.forEach((step) => {
            const y = midY - (step / 4) * (graphH / 2);
            ctx.strokeStyle = step === 0 ? 'rgba(56, 189, 248, 0.25)' : 'rgba(148, 163, 184, 0.08)';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          });

          // Real-Time High-Res Float dBFS Channel FFT Spectrum Overlay
          const spec = audioEngine.getChannelSpectrumDb(channel.id, 'L+R');
          const fftLen = spec.binsDb.length;
          const binHz = spec.sampleRate / spec.fftSize;

          const barCount = analyzerMode === 'FFT' ? 140 : analyzerMode === '12th Octave' ? 84 : 36;
          if (!frozenFftRef.current || frozenFftRef.current.length !== barCount) {
            if (!freezeSpectrum) frozenFftRef.current = null;
          }
          const liveBars = new Uint8Array(barCount);
          for (let i = 0; i < barCount; i++) {
            const fLow = normToFreq(i / barCount);
            const fHigh = normToFreq((i + 1) / barCount);
            const fMid = (fLow + fHigh) * 0.5;
            const bStart = Math.max(1, Math.floor(fLow / binHz));
            const bEnd = Math.min(fftLen - 1, Math.ceil(fHigh / binHz));
            let peakDb = -100;
            if (bEnd <= bStart + 1) {
              const exact = Math.max(1, Math.min(fftLen - 1.001, fMid / binHz));
              const b0 = Math.floor(exact);
              const frac = exact - b0;
              peakDb = spec.binsDb[b0] * (1 - frac) + spec.binsDb[b0 + 1] * frac;
            } else {
              for (let k = bStart; k <= bEnd; k++) {
                if (spec.binsDb[k] > peakDb) peakDb = spec.binsDb[k];
              }
            }
            const norm = Math.max(0, Math.min(1, (peakDb + 84) / 96));
            liveBars[i] = Math.round(norm * 255);
          }

          if (freezeSpectrum && !frozenFftRef.current) {
            frozenFftRef.current = liveBars;
          } else if (!freezeSpectrum) {
            frozenFftRef.current = null;
          }
          const bars = frozenFftRef.current ?? liveBars;

          for (let i = 0; i < barCount; i++) {
            const val = bars[i] / 255;
            if (val > 0.01) {
              const x = (i / barCount) * w;
              const bw = Math.max(2, w / barCount - 1);
              const bh = val * graphH * 0.85;
              ctx.fillStyle = 'rgba(0, 229, 255, 0.17)';
              ctx.fillRect(x, graphH - bh, bw, bh);
            }
          }

          // Individual Band Translucent Curves
          const bandIds: BandId[] = ['lf', 'lmf', 'mf', 'hmf', 'hf'];
          if (showCurves) {
            bandIds.forEach((id) => {
              const b = getBand(id);
              if (!b.on) return;
              const col = BAND_COLORS[id];
              ctx.beginPath();
              ctx.moveTo(0, midY);
              for (let px = 0; px <= w; px += 4) {
                const freq = normToFreq(px / w);
                const db = evalBandDb(id, freq);
                const y = Math.max(4, Math.min(graphH - 4, midY - (db / levelRangeDb) * (graphH / 2)));
                ctx.lineTo(px, y);
              }
              ctx.lineTo(w, midY);
              ctx.closePath();
              ctx.fillStyle = `${col}22`;
              ctx.fill();

              ctx.beginPath();
              for (let px = 0; px <= w; px += 4) {
                const freq = normToFreq(px / w);
                const db = evalBandDb(id, freq);
                const y = Math.max(4, Math.min(graphH - 4, midY - (db / levelRangeDb) * (graphH / 2)));
                if (px === 0) ctx.moveTo(px, y);
                else ctx.lineTo(px, y);
              }
              ctx.strokeStyle = `${col}99`;
              ctx.lineWidth = 1.2;
              ctx.stroke();
            });
          }

          // Composite Master EQ Curve (Glowing White-Cyan)
          ctx.beginPath();
          for (let px = 0; px <= w; px += 3) {
            const freq = normToFreq(px / w);
            let totalDb = outGain;
            bandIds.forEach((id) => {
              totalDb += evalBandDb(id, freq);
            });
            totalDb += evalCutDb(freq);
            const y = Math.max(4, Math.min(graphH - 2, midY - (totalDb / levelRangeDb) * (graphH / 2)));
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
          }
          ctx.strokeStyle = plugin.enabled ? '#e2e8f0' : '#64748b';
          ctx.lineWidth = 2.2;
          ctx.shadowColor = plugin.enabled ? '#00e5ff' : 'transparent';
          ctx.shadowBlur = plugin.enabled ? 8 : 0;
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Draggable Control Nodes
          bandIds.forEach((id) => {
            const b = getBand(id);
            const nx = freqToNorm(b.freq) * w;
            const ny = Math.max(10, Math.min(graphH - 10, midY - (b.gain / levelRangeDb) * (graphH / 2)));
            const col = BAND_COLORS[id];
            ctx.beginPath();
            ctx.arc(nx, ny, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = b.on ? col : '#334155';
            ctx.shadowColor = b.on ? col : 'transparent';
            ctx.shadowBlur = b.on ? 10 : 0;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#06090f';
            ctx.stroke();
          });

          // Low Cut & High Cut Nodes
          const lcX = freqToNorm(lcFreq) * w;
          ctx.beginPath();
          ctx.arc(lcX, midY, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = lcOn ? BAND_COLORS.lc : '#334155';
          ctx.fill();

          const hcX = freqToNorm(hcFreq) * w;
          ctx.beginPath();
          ctx.arc(hcX, midY, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = hcOn ? BAND_COLORS.hc : '#334155';
          ctx.fill();

          // Bottom Piano Keyboard Reference Strip + Freq Labels
          ctx.fillStyle = '#090c14';
          ctx.fillRect(0, graphH, w, 24);
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.beginPath();
          ctx.moveTo(0, graphH);
          ctx.lineTo(w, graphH);
          ctx.stroke();

          // Subtle piano key ticks
          const keys = 64;
          for (let k = 0; k < keys; k++) {
            const kx = (k / keys) * w;
            const kw = w / keys;
            const isBlack = [1, 3, 6, 8, 10].includes(k % 12);
            ctx.fillStyle = isBlack ? '#04060a' : '#131926';
            ctx.fillRect(kx + 0.5, graphH + 1, kw - 1, isBlack ? 8 : 13);
          }

          ctx.fillStyle = '#94a3b8';
          ctx.font = '9.5px JetBrains Mono, monospace';
          freqMarks.forEach((m) => {
            const x = freqToNorm(m.f) * w;
            ctx.fillText(m.l, x + 2, h - 3);
          });
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [analyzerMode, freezeSpectrum, hcFreq, hcOn, hcSlope, lcFreq, lcOn, lcSlope, levelRangeDb, llcHz, llcOn, llcSoft, outGain, p, plugin.enabled, showCurves]);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const graphH = rect.height - 24;
    const midY = graphH / 2;

    const candidates: { id: BandId | 'lc' | 'hc'; nx: number; ny: number }[] = [
      ...(['lf', 'lmf', 'mf', 'hmf', 'hf'] as BandId[]).map((id) => {
        const b = getBand(id);
        return {
          id,
          nx: freqToNorm(b.freq) * rect.width,
          ny: midY - (b.gain / levelRangeDb) * (graphH / 2),
        };
      }),
      { id: 'lc', nx: freqToNorm(lcFreq) * rect.width, ny: midY },
      { id: 'hc', nx: freqToNorm(hcFreq) * rect.width, ny: midY },
    ];

    let best: BandId | 'lc' | 'hc' | null = null;
    let bestDist = 20;
    for (const c of candidates) {
      const d = Math.hypot(c.nx - x, c.ny - y);
      if (d < bestDist) {
        bestDist = d;
        best = c.id;
      }
    }
    if (best) {
      draggingBandRef.current = best;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingBandRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const normX = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width));
    const freq = Number(normToFreq(normX).toFixed(1));
    const graphH = rect.height - 24;
    const relY = Math.max(0, Math.min(graphH, e.clientY - rect.top));
    const gain = Number((((graphH / 2 - relY) / (graphH / 2)) * levelRangeDb).toFixed(2));

    const target = draggingBandRef.current;
    if (target === 'lc') {
      setParam('lc_freq', Math.min(800, Math.max(20, freq)));
    } else if (target === 'hc') {
      setParam('hc_freq', Math.min(20000, Math.max(1000, freq)));
    } else {
      onUpdatePlugin(channel.id, plugin.id, (prev) => {
        const nextParams = {
          ...prev.params,
          [`${target}_freq`]: freq,
          [`${target}_gain`]: Math.max(-24, Math.min(24, gain)),
        };
        nextParams.lowGain = nextParams.lf_gain ?? 0;
        nextParams.midFreq = nextParams.mf_freq ?? 1000;
        nextParams.midGain = nextParams.mf_gain ?? 0;
        nextParams.highGain = nextParams.hf_gain ?? 0;
        return { ...prev, params: nextParams };
      });
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingBandRef.current) {
      draggingBandRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const renderBandCard = (
    id: BandId,
    label: string,
    hasShapeDropdown = false
  ) => {
    const b = getBand(id);
    const col = BAND_COLORS[id];
    return (
      <div className="p-2.5 rounded-lg bg-[#121722] border border-white/10 flex flex-col justify-between gap-2">
        {/* Band Card Header */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setParam(`${id}_on`, b.on ? 0 : 1)}
              className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-[#0a0e16] border border-white/10 text-[10.5px] font-bold text-slate-200"
            >
              <span>{label}</span>
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: b.on ? col : '#475569',
                  boxShadow: b.on ? `0 0 6px ${col}` : 'none',
                }}
              />
            </button>
            <button
              type="button"
              title="Dynamic EQ"
              onClick={() => setParam(`${id}_dyn`, b.dyn ? 0 : 1)}
              className={`w-5 h-5 rounded text-[10px] font-bold border ${
                b.dyn
                  ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400/60'
                  : 'bg-[#0b0f17] text-slate-400 border-white/10'
              }`}
            >
              D
            </button>
            <button
              type="button"
              title="Solo Band"
              onClick={() => setParam(`${id}_solo`, b.solo ? 0 : 1)}
              className={`w-5 h-5 rounded text-[10px] font-bold border ${
                b.solo
                  ? 'bg-amber-400 text-slate-950 border-amber-200'
                  : 'bg-[#0b0f17] text-slate-400 border-white/10'
              }`}
            >
              S
            </button>
          </div>

          {hasShapeDropdown && (
            <select
              value={b.shape}
              onChange={(e) => setParam(`${id}_shape`, Number(e.target.value))}
              className="px-1.5 py-0.5 rounded bg-[#0b0f17] border border-white/10 text-[10px] text-slate-200 outline-none"
            >
              <option value={0}>Peaking</option>
              <option value={1}>Shelf 6dB</option>
              <option value={2}>Shelf 12dB</option>
            </select>
          )}
        </div>

        {/* Main Knobs: Q | Gain | Freq */}
        <div className="grid grid-cols-3 items-center gap-1">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[9.5px] text-slate-400">Q</span>
            <RotaryKnob
              value={b.q}
              min={0.3}
              max={10}
              defaultValue={BAND_DEFAULTS[id].q}
              size={30}
              neonColor={col}
              label={`${label} Q`}
              onChange={(v) => setParam(`${id}_q`, v)}
            />
            <span className="text-[10px] font-mono-tabular text-slate-200">{b.q.toFixed(2)}</span>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <RotaryKnob
              value={b.gain}
              min={-24}
              max={24}
              defaultValue={0}
              size={42}
              neonColor={col}
              label={`${label} Gain`}
              onChange={(v) => setParam(`${id}_gain`, v)}
            />
            <span className="text-[10.5px] font-mono-tabular font-semibold text-white">
              {b.gain.toFixed(2)} dB
            </span>
            <span className="text-[9px] text-slate-400">Gain</span>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[9.5px] text-slate-400">Freq</span>
            <RotaryKnob
              value={b.freq}
              min={id === 'lf' ? 20 : id === 'lmf' ? 40 : id === 'mf' ? 120 : id === 'hmf' ? 600 : 1200}
              max={id === 'lf' ? 600 : id === 'lmf' ? 2000 : id === 'mf' ? 6000 : id === 'hmf' ? 14000 : 20000}
              defaultValue={BAND_DEFAULTS[id].freq}
              size={30}
              neonColor={col}
              label={`${label} Frequency`}
              onChange={(v) => setParam(`${id}_freq`, v)}
            />
            <span className="text-[10px] font-mono-tabular text-slate-200">
              {formatFreq(b.freq)}
            </span>
          </div>
        </div>

        {/* Dynamic Thrs / Range Row */}
        {dynamicsVisible && (
          <div className="flex items-center justify-center gap-3 pt-1 border-t border-white/5">
            <div className="flex items-center gap-1.5">
              <div className="text-right leading-tight">
                <div className="text-[9px] text-slate-400">Thrs.</div>
                <div className="text-[9.5px] font-mono-tabular text-slate-200">
                  {b.thrs.toFixed(1)} dB
                </div>
              </div>
              <RotaryKnob
                value={b.thrs}
                min={-48}
                max={0}
                defaultValue={0}
                size={24}
                neonColor={b.dyn ? col : '#475569'}
                label={`${label} Threshold`}
                onChange={(v) => setParam(`${id}_thrs`, v)}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <RotaryKnob
                value={b.range}
                min={-18}
                max={18}
                defaultValue={0}
                size={24}
                neonColor={b.dyn ? col : '#475569'}
                label={`${label} Range`}
                onChange={(v) => setParam(`${id}_range`, v)}
              />
              <div className="text-left leading-tight">
                <div className="text-[9px] text-slate-400">Range</div>
                <div className="text-[9.5px] font-mono-tabular text-slate-200">
                  {b.range.toFixed(1)} dB
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[940px] rounded-xl bg-[#0b0f17] border border-cyan-500/40 shadow-[0_28px_100px_rgba(0,0,0,0.92)] overflow-hidden select-none"
      >
        {/* Top Toolbar */}
        <div className="h-10 px-3 bg-[#121723] border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1 rounded border transition-all ${
                plugin.enabled
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/60 shadow-[0_0_8px_rgba(34,211,238,0.45)]'
                  : 'bg-[#1a202e] text-slate-500 border-white/10'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="text-sm font-bold text-white tracking-tight">Equalizer</span>
            <span className="text-[11px] font-mono-tabular text-cyan-300">{plugin.format}</span>
            <span className="text-[11px] text-slate-400">
              · {channel.name || `Ch ${channel.index}`}
            </span>

            <button
              type="button"
              onClick={() => setBandControlsOpen((v) => !v)}
              className={`ml-2 px-2.5 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                bandControlsOpen
                  ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                  : 'bg-[#171e2c] text-slate-300 border-white/10'
              }`}
            >
              Band Controls
            </button>
            <button
              type="button"
              onClick={() => setDynamicsVisible((v) => !v)}
              className={`px-2.5 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                dynamicsVisible
                  ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                  : 'bg-[#171e2c] text-slate-300 border-white/10'
              }`}
            >
              Dynamics
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] text-slate-400">Level Range</span>
            <select
              value={levelRangeDb}
              onChange={(e) => setLevelRangeDb(Number(e.target.value) as 6 | 12 | 24)}
              className="px-1.5 py-0.5 rounded bg-[#0a0e16] border border-cyan-500/35 text-[11px] text-cyan-300 font-mono-tabular outline-none"
            >
              <option value={24}>24dB</option>
              <option value={12}>12dB</option>
              <option value={6}>6dB</option>
            </select>

            <button
              type="button"
              onClick={() => setShowCurves((v) => !v)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                showCurves
                  ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                  : 'bg-[#171e2c] text-slate-300 border-white/10'
              }`}
            >
              Curves
            </button>

            <select
              value={analyzerMode}
              onChange={(e) =>
                setAnalyzerMode(e.target.value as '12th Octave' | '3rd Octave' | 'FFT')
              }
              className="px-2 py-0.5 rounded bg-cyan-500 text-slate-950 text-[11px] font-semibold outline-none"
            >
              <option value="12th Octave">12th Octave</option>
              <option value="3rd Octave">3rd Octave</option>
              <option value="FFT">FFT</option>
            </select>

            <button
              type="button"
              title="Freeze Spectrum"
              onClick={() => setFreezeSpectrum((v) => !v)}
              className={`p-1 rounded border ${
                freezeSpectrum
                  ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400'
                  : 'bg-[#171e2c] text-slate-400 border-white/10 hover:text-white'
              }`}
            >
              <Snowflake className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setHighQuality((v) => !v)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                highQuality
                  ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                  : 'bg-[#171e2c] text-slate-300 border-white/10'
              }`}
            >
              High Quality
            </button>

            <button
              type="button"
              onClick={onClose}
              className="ml-1 p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Interactive EQ Curve Graph */}
        <div className="relative bg-[#06090f] border-b border-white/10 flex">
          {/* Left Meter Scale */}
          <div className="w-9 py-2 px-1 bg-[#090d16] border-r border-white/10 flex flex-col justify-between text-[9px] font-mono-tabular text-cyan-300/80 text-right">
            <span>+{levelRangeDb}</span>
            <span>+{levelRangeDb / 2}</span>
            <span className="text-white">0 dB</span>
            <span>-{levelRangeDb / 2}</span>
            <span>-{levelRangeDb}</span>
          </div>

          <canvas
            ref={canvasRef}
            width={860}
            height={265}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            className="flex-1 h-[265px] block cursor-crosshair"
          />

          {/* Right Meter Scale */}
          <div className="w-9 py-2 px-1 bg-[#090d16] border-l border-white/10 flex flex-col justify-between text-[9px] font-mono-tabular text-slate-400">
            <span>12</span>
            <span>0</span>
            <span>-12</span>
            <span>-24</span>
            <span>-48</span>
          </div>
        </div>

        {/* Middle & Bottom Band Controls */}
        {bandControlsOpen && (
          <div className="p-2.5 space-y-2.5 bg-[#0a0d14]">
            {/* Row 1: LLC | LF | MF | HF | Master Gain */}
            <div className="grid grid-cols-12 gap-2">
              {/* LLC Block */}
              <div className="col-span-1 p-2 rounded-lg bg-[#121722] border border-white/10 flex flex-col justify-between items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setParam('llc_on', llcOn ? 0 : 1)}
                  className="w-full py-0.5 px-1 rounded bg-[#0a0e16] border border-white/10 text-[10px] font-bold text-slate-200 flex items-center justify-between"
                >
                  <span>LLC</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      llcOn ? 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]' : 'bg-slate-600'
                    }`}
                  />
                </button>
                <div className="w-full space-y-0.5">
                  {[80, 50, 20].map((hz) => (
                    <button
                      key={hz}
                      type="button"
                      onClick={() => setParam('llc_hz', hz)}
                      className={`w-full py-0.5 rounded text-[9.5px] font-mono-tabular border ${
                        llcHz === hz
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50'
                          : 'bg-[#0b0f17] text-slate-400 border-white/5'
                      }`}
                    >
                      {hz} Hz
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setParam('llc_soft', llcSoft ? 0 : 1)}
                  className={`w-full py-0.5 rounded text-[10px] font-medium border ${
                    llcSoft
                      ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400/60'
                      : 'bg-[#0b0f17] text-slate-400 border-white/10'
                  }`}
                >
                  Soft
                </button>
              </div>

              <div className="col-span-3">{renderBandCard('lf', 'LF', true)}</div>
              <div className="col-span-3">{renderBandCard('mf', 'MF', false)}</div>
              <div className="col-span-4">{renderBandCard('hf', 'HF', true)}</div>

              {/* Master Gain Block */}
              <div className="col-span-1 p-2 rounded-lg bg-[#121722] border border-white/10 flex flex-col items-center justify-between">
                <span className="text-[10.5px] font-medium text-slate-300">Gain</span>
                <RotaryKnob
                  value={outGain}
                  min={-18}
                  max={18}
                  defaultValue={0}
                  size={40}
                  neonColor="#00e5ff"
                  label="Output Gain"
                  onChange={(v) => setParam('out_gain', v)}
                />
                <span className="text-[10px] font-mono-tabular text-slate-200">
                  {outGain.toFixed(2)} dB
                </span>
                <button
                  type="button"
                  onClick={() => setParam('auto_gain', autoGain ? 0 : 1)}
                  className={`w-full py-0.5 rounded text-[10px] font-semibold border ${
                    autoGain
                      ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400/60'
                      : 'bg-[#0b0f17] text-slate-400 border-white/10'
                  }`}
                >
                  Auto
                </button>
              </div>
            </div>

            {/* Row 2: LC | LMF | HMF | HC */}
            <div className="grid grid-cols-12 gap-2">
              {/* LC Block */}
              <div className="col-span-3 p-2.5 rounded-lg bg-[#121722] border border-white/10 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setParam('lc_on', lcOn ? 0 : 1)}
                    className="px-2 py-0.5 rounded bg-[#0a0e16] border border-white/10 text-[10.5px] font-bold text-slate-200 flex items-center gap-1.5"
                  >
                    <span>LC</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        lcOn ? 'bg-slate-200 shadow-[0_0_6px_#e2e8f0]' : 'bg-slate-600'
                      }`}
                    />
                  </button>
                  <select
                    value={lcSlope}
                    onChange={(e) => setParam('lc_slope', Number(e.target.value))}
                    className="px-1.5 py-0.5 rounded bg-[#0b0f17] border border-white/10 text-[10px] text-slate-200 outline-none"
                  >
                    <option value={6}>6dB/Oct</option>
                    <option value={12}>12dB/Oct</option>
                    <option value={24}>24dB/Oct</option>
                    <option value={48}>48dB/Oct</option>
                  </select>
                </div>
                <div className="flex flex-col items-center gap-1 my-auto py-2">
                  <RotaryKnob
                    value={lcFreq}
                    min={20}
                    max={800}
                    defaultValue={28}
                    size={44}
                    neonColor="#94a3b8"
                    label="Low Cut Freq"
                    onChange={(v) => setParam('lc_freq', v)}
                  />
                  <div className="flex items-center gap-2 text-[10.5px]">
                    <span className="text-slate-400">Freq</span>
                    <span className="font-mono-tabular text-slate-100">{formatFreq(lcFreq)}</span>
                  </div>
                </div>
              </div>

              <div className="col-span-3">{renderBandCard('lmf', 'LMF', false)}</div>
              <div className="col-span-3">{renderBandCard('hmf', 'HMF', false)}</div>

              {/* HC Block */}
              <div className="col-span-3 p-2.5 rounded-lg bg-[#121722] border border-white/10 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setParam('hc_on', hcOn ? 0 : 1)}
                    className="px-2 py-0.5 rounded bg-[#0a0e16] border border-white/10 text-[10.5px] font-bold text-slate-200 flex items-center gap-1.5"
                  >
                    <span>HC</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        hcOn ? 'bg-violet-400 shadow-[0_0_6px_#a78bfa]' : 'bg-slate-600'
                      }`}
                    />
                  </button>
                  <select
                    value={hcSlope}
                    onChange={(e) => setParam('hc_slope', Number(e.target.value))}
                    className="px-1.5 py-0.5 rounded bg-[#0b0f17] border border-white/10 text-[10px] text-slate-200 outline-none"
                  >
                    <option value={6}>6dB/Oct</option>
                    <option value={12}>12dB/Oct</option>
                    <option value={24}>24dB/Oct</option>
                    <option value={48}>48dB/Oct</option>
                  </select>
                </div>
                <div className="flex flex-col items-center gap-1 my-auto py-2">
                  <RotaryKnob
                    value={hcFreq}
                    min={1000}
                    max={20000}
                    defaultValue={16260}
                    size={44}
                    neonColor="#a78bfa"
                    label="High Cut Freq"
                    onChange={(v) => setParam('hc_freq', v)}
                  />
                  <div className="flex items-center gap-2 text-[10.5px]">
                    <span className="text-slate-400">Freq</span>
                    <span className="font-mono-tabular text-slate-100">{formatFreq(hcFreq)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
