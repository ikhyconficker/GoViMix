import React, { useEffect, useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';

interface SpectrumModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

type AnalysisMode =
  | 'Octave'
  | '3rd Octave'
  | '12th Octave'
  | 'FFT'
  | 'FFT Curve'
  | 'Waterfall'
  | 'Sonogram'
  | 'Segments';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function freqToNoteInfo(freq: number): { note: string; cents: number } {
  const midiFloat = 69 + 12 * Math.log2(Math.max(20, freq) / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const noteName = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { note: `${noteName}${octave}`, cents };
}

function normToFreq(norm: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.pow(10, minLog + Math.max(0, Math.min(1, norm)) * (maxLog - minLog));
}

function freqToNorm(freq: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.max(0, Math.min(1, (Math.log10(Math.max(20, freq)) - minLog) / (maxLog - minLog)));
}

export const SpectrumModal: React.FC<SpectrumModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakHoldRef = useRef<Float32Array>(new Float32Array(128).fill(0));
  const avgBufRef = useRef<Float32Array>(new Float32Array(128).fill(0));
  const waterfallRef = useRef<number[][]>([]);

  const [channelMode, setChannelMode] = useState<'L+R' | 'L' | 'R' | 'M' | 'S'>('L+R');
  const [holdMode, setHoldMode] = useState<'None' | 'Peak' | 'Infinite'>('None');
  const [averageMode, setAverageMode] = useState<'Off' | 'Fast' | 'Medium' | 'Slow'>('Slow');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('12th Octave');
  const [fixedRange, setFixedRange] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    freq: number;
    db: number;
    note: string;
    cents: number;
  } | null>(null);

  useEffect(() => {
    let raf = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const pianoH = 18;
          const plotH = h - pianoH;

          // Background (deep dark teal-black)
          ctx.fillStyle = '#061113';
          ctx.fillRect(0, 0, w, h);

          // dB horizontal grid lines
          const dbTicks = [12, 6, 0, -6, -12, -18, -24, -36, -48, -72, -96];
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
          ctx.lineWidth = 1;
          for (const db of dbTicks) {
            const y = ((12 - db) / 108) * plotH;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }

          // Frequency vertical grid lines
          for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
            const x = freqToNorm(f) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, plotH);
            ctx.stroke();
          }

          // Sample live FFT
          const fft = audioEngine.getChannelSpectrum(channel.id, channelMode);
          const sampleRate = audioEngine.getContext()?.sampleRate ?? 48000;
          const nyquist = sampleRate / 2;

          const barCount =
            analysisMode === 'Octave'
              ? 11
              : analysisMode === '3rd Octave'
              ? 31
              : analysisMode === '12th Octave'
              ? 96
              : analysisMode === 'Segments'
              ? 48
              : 128;

          const smoothAlpha =
            averageMode === 'Off'
              ? 0.9
              : averageMode === 'Fast'
              ? 0.45
              : averageMode === 'Medium'
              ? 0.22
              : 0.12;

          const currentFrame: number[] = [];
          for (let i = 0; i < barCount; i++) {
            const fLow = normToFreq(i / barCount);
            const fHigh = normToFreq((i + 1) / barCount);
            const binStart = Math.max(1, Math.floor((fLow / nyquist) * fft.length));
            const binEnd = Math.min(fft.length - 1, Math.max(binStart, Math.ceil((fHigh / nyquist) * fft.length)));
            let maxVal = 0;
            for (let b = binStart; b <= binEnd; b++) {
              if (fft[b] > maxVal) maxVal = fft[b];
            }
            const norm = plugin.enabled ? maxVal / 255 : 0;
            const prevAvg = avgBufRef.current[i] ?? 0;
            const smoothed = prevAvg + (norm - prevAvg) * smoothAlpha;
            avgBufRef.current[i] = smoothed;
            currentFrame.push(smoothed);

            if (holdMode === 'Infinite') {
              peakHoldRef.current[i] = Math.max(peakHoldRef.current[i], smoothed);
            } else if (holdMode === 'Peak') {
              peakHoldRef.current[i] = Math.max(peakHoldRef.current[i] * 0.992, smoothed);
            } else {
              peakHoldRef.current[i] = 0;
            }
          }

          if (analysisMode === 'Waterfall' || analysisMode === 'Sonogram') {
            waterfallRef.current.unshift(currentFrame);
            if (waterfallRef.current.length > 36) waterfallRef.current.pop();
          }

          // Render chosen analysis mode
          if (analysisMode === 'Sonogram') {
            const rows = waterfallRef.current;
            const rowH = plotH / 36;
            rows.forEach((row, rIdx) => {
              const y = rIdx * rowH;
              row.forEach((v, cIdx) => {
                const x = (cIdx / barCount) * w;
                const bw = w / barCount + 1;
                ctx.fillStyle = `hsla(${200 - v * 170}, 90%, ${8 + v * 58}%, 0.92)`;
                ctx.fillRect(x, y, bw, rowH + 0.5);
              });
            });
          } else if (analysisMode === 'Waterfall') {
            const rows = waterfallRef.current;
            for (let r = rows.length - 1; r >= 0; r--) {
              const row = rows[r];
              const offsetY = (r / 36) * (plotH * 0.55);
              ctx.beginPath();
              row.forEach((v, cIdx) => {
                const x = (cIdx / (barCount - 1)) * w;
                const y = plotH - offsetY - v * (plotH * 0.45);
                if (cIdx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              });
              ctx.strokeStyle = `rgba(56, 189, 248, ${Math.max(0.12, 1 - r / 32)})`;
              ctx.lineWidth = 1.3;
              ctx.stroke();
            }
          } else if (analysisMode === 'FFT Curve' || analysisMode === 'FFT') {
            ctx.beginPath();
            ctx.moveTo(0, plotH);
            currentFrame.forEach((v, idx) => {
              const x = (idx / (barCount - 1)) * w;
              const y = plotH - v * (plotH * 0.9);
              ctx.lineTo(x, y);
            });
            ctx.lineTo(w, plotH);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, 0, 0, plotH);
            grad.addColorStop(0, 'rgba(34, 211, 238, 0.55)');
            grad.addColorStop(1, 'rgba(14, 116, 144, 0.08)');
            ctx.fillStyle = grad;
            ctx.fill();

            ctx.beginPath();
            currentFrame.forEach((v, idx) => {
              const x = (idx / (barCount - 1)) * w;
              const y = plotH - v * (plotH * 0.9);
              if (idx === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.8;
            ctx.stroke();
          } else {
            // Octave / 3rd Octave / 12th Octave / Segments bars
            const bw = w / barCount;
            const gap = barCount > 60 ? 1 : 2;
            currentFrame.forEach((v, idx) => {
              const x = idx * bw;
              const barH = v * (plotH * 0.9);
              const y = plotH - barH;
              const grad = ctx.createLinearGradient(0, y, 0, plotH);
              grad.addColorStop(0, '#38bdf8');
              grad.addColorStop(0.5, '#0ea5e9');
              grad.addColorStop(1, '#075985');
              ctx.fillStyle = grad;
              ctx.fillRect(x, y, Math.max(1, bw - gap), barH);

              if (holdMode !== 'None' && peakHoldRef.current[idx] > 0.01) {
                const py = plotH - peakHoldRef.current[idx] * (plotH * 0.9);
                ctx.fillStyle = '#bae6fd';
                ctx.fillRect(x, py, Math.max(1, bw - gap), 1.5);
              }
            });
          }

          // Bottom Piano Keyboard strip
          ctx.fillStyle = '#181c22';
          ctx.fillRect(0, plotH, w, pianoH);
          const totalKeys = 72;
          const kw = w / totalKeys;
          for (let k = 0; k < totalKeys; k++) {
            const noteIdx = k % 12;
            const isBlack = [1, 3, 6, 8, 10].includes(noteIdx);
            ctx.fillStyle = isBlack ? '#0b0e13' : '#58606b';
            ctx.fillRect(k * kw + 0.5, plotH + 1, kw - 1, isBlack ? pianoH * 0.62 : pianoH - 2);
          }

          // Hover Crosshair
          if (hoverInfo) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hoverInfo.x, 0);
            ctx.lineTo(hoverInfo.x, plotH);
            ctx.moveTo(0, hoverInfo.y);
            ctx.lineTo(w, hoverInfo.y);
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [analysisMode, averageMode, channel.id, channelMode, holdMode, hoverInfo, plugin.enabled]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const plotH = canvas.height - 18;
    const normX = Math.max(0, Math.min(1, x / canvas.width));
    const freq = normToFreq(normX);
    const db = 12 - (Math.max(0, Math.min(plotH, y)) / plotH) * 108;
    const { note, cents } = freqToNoteInfo(freq);
    setHoverInfo({ x, y, freq, db, note, cents });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[780px] rounded-md bg-[#1d2025] border border-black shadow-[0_28px_90px_rgba(0,0,0,0.92)] overflow-hidden select-none text-slate-200"
      >
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#12151a] border-b border-black">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1 rounded border ${
                plugin.enabled
                  ? 'bg-[#0b6ef6]/25 text-[#3ba3ff] border-[#1f84ff]/70'
                  : 'bg-[#2a2d33] text-slate-500 border-black'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="text-[16px] font-normal text-white">Spectrum Meter</span>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-300">Channel Mode</span>
              <select
                value={channelMode}
                onChange={(e) => setChannelMode(e.target.value as typeof channelMode)}
                className="bg-[#232730] text-[#60a5fa] border border-black/70 rounded px-2 py-0.5 text-[11px] focus:outline-none"
              >
                {['L+R', 'L', 'R', 'M', 'S'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-slate-300 mr-0.5">Level Range</span>
              <span className="px-2 py-0.5 rounded bg-[#232730] border border-black/70 font-mono-tabular text-[#60a5fa]">
                -96 dB
              </span>
              <span className="px-2 py-0.5 rounded bg-[#232730] border border-black/70 font-mono-tabular text-[#60a5fa]">
                12 dB
              </span>
              <button
                type="button"
                onClick={() => setFixedRange((v) => !v)}
                className={`px-2 py-0.5 rounded border ${
                  fixedRange
                    ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                    : 'bg-[#232730] text-[#60a5fa] border-black/70'
                }`}
              >
                Fixed
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Spectrum Plot Area */}
        <div className="relative bg-[#061113] flex">
          {/* Left dB Scale */}
          <div className="w-8 flex flex-col justify-between py-1 pb-6 pr-1 text-right text-[9.5px] font-mono-tabular text-[#94a3b8]">
            {[12, 6, 0, -6, -12, -18, -24, -36, -48, -72, -96].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="relative flex-1">
            <canvas
              ref={canvasRef}
              width={700}
              height={265}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverInfo(null)}
              className="w-full h-[265px] block cursor-crosshair"
            />
            {hoverInfo && (
              <div
                className="pointer-events-none absolute bg-[#e2e8f0] text-[#0f172a] text-[10.5px] font-mono-tabular px-2 py-0.5 rounded-[2px] shadow-lg border border-black/30 whitespace-nowrap"
                style={{
                  left: Math.min(480, Math.max(10, (hoverInfo.x / 700) * 100)) + '%',
                  top: Math.max(8, Math.min(200, hoverInfo.y - 24)),
                }}
              >
                Note: {hoverInfo.note} {hoverInfo.cents >= 0 ? `+${hoverInfo.cents}` : hoverInfo.cents}ct:{' '}
                {Math.round(hoverInfo.freq * 0.97)} - {Math.round(hoverInfo.freq * 1.03)} Hz | Level:{' '}
                {hoverInfo.db.toFixed(1)} dB
              </div>
            )}
          </div>
        </div>

        {/* Frequency Axis Labels */}
        <div className="relative h-5 bg-[#090d10] border-b border-black text-[9.5px] font-mono-tabular text-slate-300 pl-8">
          {[
            { f: 50, lbl: '50' },
            { f: 100, lbl: '100' },
            { f: 200, lbl: '200' },
            { f: 500, lbl: '500' },
            { f: 1000, lbl: '1 k' },
            { f: 2000, lbl: '2 k' },
            { f: 5000, lbl: '5 k' },
            { f: 10000, lbl: '10 k' },
          ].map((item) => (
            <span
              key={item.f}
              className="absolute top-0.5 -translate-x-1/2"
              style={{ left: `calc(32px + ${freqToNorm(item.f)} * (100% - 32px))` }}
            >
              {item.lbl}
            </span>
          ))}
        </div>

        {/* Hold / Average / Freq Range Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#16191e] border-b border-black text-[11px]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-300">Hold</span>
              <select
                value={holdMode}
                onChange={(e) => setHoldMode(e.target.value as typeof holdMode)}
                className="bg-[#232730] text-[#60a5fa] border border-black/70 rounded px-2 py-0.5 text-[11px]"
              >
                <option value="None">None</option>
                <option value="Peak">Peak</option>
                <option value="Infinite">Infinite</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-300">Average</span>
              <select
                value={averageMode}
                onChange={(e) => setAverageMode(e.target.value as typeof averageMode)}
                className="bg-[#232730] text-[#e0f2fe] border border-black/70 rounded px-2 py-0.5 text-[11px]"
              >
                <option value="Off">Off</option>
                <option value="Fast">Fast</option>
                <option value="Medium">Medium</option>
                <option value="Slow">Slow</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-300">Freq. Range</span>
            <span className="px-2.5 py-0.5 rounded bg-[#232730] border border-black/70 font-mono-tabular text-[#60a5fa]">
              20.0 Hz &nbsp; 20.00 k
            </span>
          </div>
        </div>

        {/* Bottom Analysis Mode Bar */}
        <div className="flex items-center gap-2 px-3 py-2.5 bg-[#585a5f] border-t border-white/10">
          <span className="text-[14px] text-[#e2e4e8] mr-2">Analysis</span>
          <div className="flex flex-wrap items-center gap-1 flex-1">
            {(
              [
                'Octave',
                '3rd Octave',
                '12th Octave',
                'FFT',
                'FFT Curve',
                'Waterfall',
                'Sonogram',
                'Segments',
              ] as AnalysisMode[]
            ).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAnalysisMode(mode)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                  analysisMode === mode
                    ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                    : 'bg-[#3c3f45] text-slate-200 border-[#24262a] hover:bg-[#494c53]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
