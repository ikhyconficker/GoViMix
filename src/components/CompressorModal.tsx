import React, { useEffect, useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { audioEngine, linearToDb } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface CompressorModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

const SCALE_TICKS = [6, 3, 0, -3, -6, -9, -12, -24, -36, -48, -60];

export const CompressorModal: React.FC<CompressorModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingNodeRef = useRef(false);
  const lastRedRef = useRef(0);
  const [reductionDb, setReductionDb] = useState(0);

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  const threshold = getVal('threshold', -29.52);
  const ratio = getVal('ratio', 4.2);
  const knee = getVal('knee', 3.88);
  const attack = getVal('attack', 0.45);
  const release = getVal('release', 56.2);
  const sideGain = getVal('sideGain', 1.5);
  const makeup = getVal('makeup', 0.0);
  const lowCut = getVal('lowCut', 80);
  const highCut = getVal('highCut', 12000);
  const mix = getVal('mix', 81.0);

  const lookAhead = getVal('lookAhead', 1) === 1;
  const channelLink = getVal('channelLink', 0) === 1;
  const autoEnv = getVal('autoEnv', 0) === 1;
  const adaptive = getVal('adaptive', 0) === 1;
  const autoMakeup = getVal('autoMakeup', 0) === 1;
  const scFilter = getVal('scFilter', 0) === 1;
  const scListen = getVal('scListen', 0) === 1;
  const scSwap = getVal('scSwap', 0) === 1;

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => ({
      ...prev,
      params: { ...prev.params, [key]: val },
    }));
  };

  useEffect(() => {
    let raf = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Deep studio black background
          ctx.fillStyle = '#070a0f';
          ctx.fillRect(0, 0, w, h);

          const padL = 36;
          const padR = 38;
          const padT = 12;
          const padB = 18;
          const gw = w - padL - padR;
          const gh = h - padT - padB;

          const dbToX = (db: number) => padL + ((db + 60) / 60) * gw;
          const dbToY = (db: number) => padT + ((0 - db) / 60) * gh;

          // Grid lines at -48, -36, -24, -12
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
          ctx.lineWidth = 1;
          for (const db of [-48, -36, -24, -12]) {
            const x = dbToX(db);
            ctx.beginPath();
            ctx.moveTo(x, padT);
            ctx.lineTo(x, padT + gh);
            ctx.stroke();
          }
          for (const db of [-6, -12, -18, -24, -36, -48]) {
            const y = dbToY(db);
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + gw, y);
            ctx.stroke();
          }

          // Graph border
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
          ctx.strokeRect(padL, padT, gw, gh);

          // Axis labels inside grid
          ctx.fillStyle = '#64748b';
          ctx.font = '10px ui-monospace, monospace';
          ctx.textAlign = 'left';
          ctx.fillText('0', padL + 4, padT + 11);
          for (const db of [-6, -12, -18, -24, -36, -48]) {
            ctx.fillText(`${db}`, padL + 4, dbToY(db) - 3);
          }
          ctx.textAlign = 'center';
          for (const db of [-36, -24, -12]) {
            ctx.fillText(`${db}`, dbToX(db), padT + gh - 4);
          }

          // Compute transfer curve with soft knee
          const computeOutDb = (inDb: number) => {
            const k = Math.max(0.1, knee * 2.5);
            const diff = inDb - threshold;
            if (2 * diff < -k) {
              return inDb;
            }
            if (2 * Math.abs(diff) <= k) {
              return inDb + ((1 / ratio - 1) * Math.pow(diff + k / 2, 2)) / (2 * k);
            }
            return threshold + diff / ratio;
          };

          // Subtle unity diagonal
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.2)';
          ctx.setLineDash([3, 3]);
          ctx.moveTo(dbToX(-60), dbToY(-60));
          ctx.lineTo(dbToX(0), dbToY(0));
          ctx.stroke();
          ctx.setLineDash([]);

          // Transfer curve
          ctx.beginPath();
          ctx.strokeStyle = plugin.enabled ? '#7ea2ba' : '#475569';
          ctx.lineWidth = 2;
          for (let i = 0; i <= 120; i++) {
            const inDb = -60 + (i / 120) * 60;
            const outDb = Math.max(-60, Math.min(0, computeOutDb(inDb)));
            const x = dbToX(inDb);
            const y = dbToY(outDb);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // Live signal dot + gain reduction meter
          const metrics = audioEngine.getChannelStereoMetrics(channel.id);
          const inLevelDb = Math.max(-60, Math.min(0, linearToDb(Math.max(metrics.peakL, metrics.peakR))));
          const liveRed = plugin.enabled ? audioEngine.getChannelReduction(channel.id) : 0;
          if (Math.abs(liveRed - lastRedRef.current) >= 0.05) {
            lastRedRef.current = liveRed;
            setReductionDb(liveRed);
          }

          if (inLevelDb > -59) {
            const dotX = dbToX(inLevelDb);
            const dotY = dbToY(Math.max(-60, Math.min(0, computeOutDb(inLevelDb))));
            ctx.beginPath();
            ctx.fillStyle = '#38bdf8';
            ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
            ctx.fill();
          }

          // Threshold handle dot
          const thX = dbToX(threshold);
          const thY = dbToY(Math.max(-60, Math.min(0, computeOutDb(threshold))));
          ctx.beginPath();
          ctx.fillStyle = plugin.enabled ? '#2ca2ff' : '#64748b';
          ctx.strokeStyle = '#e0f2fe';
          ctx.lineWidth = 1.2;
          ctx.arc(thX, thY, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Side reduction bar on right edge of graph
          const redNorm = Math.min(1, Math.abs(liveRed) / 24);
          ctx.fillStyle = '#111827';
          ctx.fillRect(padL + gw + 4, padT, 5, gh);
          if (redNorm > 0.01) {
            ctx.fillStyle = '#f97316';
            ctx.fillRect(padL + gw + 4, padT, 5, gh * redNorm);
          }

          // Left input meter bar
          const inNorm = Math.max(0, (inLevelDb + 60) / 60);
          ctx.fillStyle = '#111827';
          ctx.fillRect(padL - 9, padT, 5, gh);
          if (inNorm > 0.01) {
            ctx.fillStyle = '#0ea5e9';
            ctx.fillRect(padL - 9, padT + gh * (1 - inNorm), 5, gh * inNorm);
          }
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [channel.id, knee, plugin.enabled, ratio, threshold]);

  const handleCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padL = 36;
    const padR = 38;
    const gw = canvas.width - padL - padR;
    const scaleX = canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scaleX;
    const norm = Math.max(0, Math.min(1, (x - padL) / gw));
    const nextThresh = Number((-60 + norm * 60).toFixed(2));
    setParam('threshold', nextThresh);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[820px] rounded-md bg-[#232529] border border-[#121417] shadow-[0_28px_90px_rgba(0,0,0,0.92)] overflow-hidden select-none text-slate-200"
      >
        {/* Top Studio Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#1b1d21] border-b border-black/80">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1 rounded border transition-all ${
                plugin.enabled
                  ? 'bg-[#0b6ef6]/25 text-[#3ba3ff] border-[#1f84ff]/70 shadow-[0_0_8px_rgba(31,132,255,0.45)]'
                  : 'bg-[#2a2d33] text-slate-500 border-black/50'
              }`}
              title="Bypass / Enable"
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="text-[14px] font-semibold tracking-tight text-white">Compressor</span>
            <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-black/50 text-[#38bdf8] border border-white/10">
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
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Studio One / Fender Compressor Layout */}
        <div className="grid grid-cols-[118px_1fr_316px] gap-1.5 p-1.5 bg-[#1a1c20]">
          {/* Left Panel: Threshold / Ratio / Knee */}
          <div className="bg-[#5a5c61] rounded border border-[#2d2f33] shadow-inner flex flex-col items-center justify-between py-3 px-2 gap-3">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[12px] text-[#d4d6db] font-medium">Threshold</span>
              <RotaryKnob
                value={threshold}
                min={-60}
                max={0}
                defaultValue={-29.52}
                size={46}
                neonColor="#2196f3"
                label="Threshold"
                onChange={(v) => setParam('threshold', v)}
              />
              <span className="text-[11px] font-mono-tabular text-white">
                {threshold.toFixed(2)} dB
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <span className="text-[12px] text-[#d4d6db] font-medium">Ratio</span>
              <RotaryKnob
                value={ratio}
                min={1}
                max={20}
                defaultValue={4.2}
                size={46}
                neonColor="#2196f3"
                label="Ratio"
                onChange={(v) => setParam('ratio', v)}
              />
              <span className="text-[11px] font-mono-tabular text-white">
                {ratio.toFixed(1)} : 1
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <span className="text-[12px] text-[#d4d6db] font-medium">Knee</span>
              <RotaryKnob
                value={knee}
                min={0}
                max={12}
                defaultValue={3.88}
                size={38}
                neonColor="#2196f3"
                label="Knee"
                onChange={(v) => setParam('knee', v)}
              />
              <span className="text-[11px] font-mono-tabular text-white">
                {knee.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Center Panel: Transfer Curve & Reduction Meters */}
          <div className="bg-[#080b10] rounded border border-black flex flex-col justify-between overflow-hidden">
            <div className="relative flex-1 flex items-stretch">
              {/* Left dB Scale */}
              <div className="w-7 flex flex-col justify-between py-2.5 text-right pr-1 text-[9px] font-mono-tabular text-[#6da8dc]">
                {SCALE_TICKS.map((t) => (
                  <span key={`l-${t}`}>{t}</span>
                ))}
              </div>

              <canvas
                ref={canvasRef}
                width={320}
                height={240}
                onPointerDown={(e) => {
                  draggingNodeRef.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  handleCanvasPointer(e);
                }}
                onPointerMove={(e) => {
                  if (draggingNodeRef.current) handleCanvasPointer(e);
                }}
                onPointerUp={(e) => {
                  draggingNodeRef.current = false;
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    // ignore
                  }
                }}
                className="flex-1 w-full h-[242px] cursor-crosshair"
              />

              {/* Right dB Scale */}
              <div className="w-7 flex flex-col justify-between py-2.5 text-left pl-1 text-[9px] font-mono-tabular text-[#6da8dc]">
                {SCALE_TICKS.map((t) => (
                  <span key={`r-${t}`}>{t}</span>
                ))}
              </div>
            </div>

            {/* Bottom Control Strip */}
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#0c0f15] border-t border-white/10">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setParam('lookAhead', lookAhead ? 0 : 1)}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                    lookAhead
                      ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                      : 'bg-[#2a2d34] text-slate-300 border-black/60'
                  }`}
                >
                  Look Ahead
                </button>
                <button
                  type="button"
                  onClick={() => setParam('channelLink', channelLink ? 0 : 1)}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                    channelLink
                      ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                      : 'bg-[#2a2d34] text-[#60a5fa] border-black/60'
                  }`}
                >
                  Channel Link
                </button>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-300">Reduction</span>
                <span className="font-mono-tabular text-[#38bdf8] font-semibold min-w-[54px] text-right">
                  {reductionDb.toFixed(2)} dB
                </span>
              </div>
            </div>
          </div>

          {/* Right Panel: Envelope, Gain, Ext. Sidechain, Global */}
          <div className="flex flex-col gap-1.5">
            {/* Top Row: Envelope + Gain */}
            <div className="grid grid-cols-[1.22fr_1fr] gap-1.5 flex-1">
              {/* Envelope */}
              <div className="bg-[#5a5c61] rounded border border-[#2d2f33] p-2.5 flex flex-col justify-between">
                <div className="text-[13px] font-normal text-[#d8dadf] leading-none">Envelope</div>
                <div className="grid grid-cols-2 gap-2 my-1">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[11px] text-[#d4d6db]">Attack</span>
                    <RotaryKnob
                      value={attack}
                      min={0.1}
                      max={100}
                      defaultValue={0.45}
                      size={40}
                      neonColor="#2196f3"
                      label="Attack"
                      onChange={(v) => setParam('attack', v)}
                    />
                    <span className="text-[10.5px] font-mono-tabular text-white">
                      {attack.toFixed(2)} ms
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[11px] text-[#d4d6db]">Release</span>
                    <RotaryKnob
                      value={release}
                      min={5}
                      max={1000}
                      defaultValue={56.2}
                      size={40}
                      neonColor="#2196f3"
                      label="Release"
                      onChange={(v) => setParam('release', v)}
                    />
                    <span className="text-[10.5px] font-mono-tabular text-white">
                      {release.toFixed(1)} ms
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setParam('autoEnv', autoEnv ? 0 : 1)}
                    className={`py-1 rounded text-[11px] border ${
                      autoEnv
                        ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                        : 'bg-[#36383d] text-slate-200 border-[#222428]'
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => setParam('adaptive', adaptive ? 0 : 1)}
                    className={`py-1 rounded text-[11px] border ${
                      adaptive
                        ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                        : 'bg-[#36383d] text-slate-200 border-[#222428]'
                    }`}
                  >
                    Adaptive
                  </button>
                </div>
              </div>

              {/* Gain */}
              <div className="bg-[#5a5c61] rounded border border-[#2d2f33] p-2.5 flex flex-col justify-between">
                <div className="text-[13px] font-normal text-[#d8dadf] leading-none">Gain</div>
                <div className="grid grid-cols-2 gap-1.5 my-1">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10.5px] text-[#d4d6db] whitespace-nowrap">Side Gain</span>
                    <RotaryKnob
                      value={sideGain}
                      min={-12}
                      max={12}
                      defaultValue={1.5}
                      size={38}
                      neonColor="#2196f3"
                      label="Side Gain"
                      onChange={(v) => setParam('sideGain', v)}
                    />
                    <span className="text-[10px] font-mono-tabular text-white">
                      {sideGain.toFixed(2)} dB
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10.5px] text-[#d4d6db]">Makeup</span>
                    <RotaryKnob
                      value={makeup}
                      min={0}
                      max={24}
                      defaultValue={0}
                      size={38}
                      neonColor="#2196f3"
                      label="Makeup"
                      onChange={(v) => setParam('makeup', v)}
                    />
                    <span className="text-[10px] font-mono-tabular text-white">
                      {makeup.toFixed(2)} dB
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setParam('autoMakeup', autoMakeup ? 0 : 1)}
                  className={`w-full py-1 rounded text-[11px] border ${
                    autoMakeup
                      ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                      : 'bg-[#36383d] text-slate-300 border-[#222428]'
                  }`}
                >
                  Auto
                </button>
              </div>
            </div>

            {/* Bottom Row: Ext. Sidechain + Global */}
            <div className="grid grid-cols-[1.85fr_1fr] gap-1.5">
              {/* Ext. Sidechain */}
              <div className="bg-[#5a5c61] rounded border border-[#2d2f33] p-2.5 flex flex-col justify-between gap-1.5">
                <div className="text-[13px] font-normal text-[#d8dadf] leading-none">Ext. Sidechain</div>
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => setParam('scFilter', scFilter ? 0 : 1)}
                      className={`px-3 py-1 rounded text-[11px] border ${
                        scFilter
                          ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                          : 'bg-[#36383d] text-slate-200 border-[#222428]'
                      }`}
                    >
                      Filter
                    </button>
                    <button
                      type="button"
                      onClick={() => setParam('scListen', scListen ? 0 : 1)}
                      className={`px-3 py-1 rounded text-[11px] border ${
                        scListen
                          ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                          : 'bg-[#36383d] text-slate-200 border-[#222428]'
                      }`}
                    >
                      Listen
                    </button>
                  </div>

                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[10.5px] text-[#d4d6db]">Low Cut</span>
                    <RotaryKnob
                      value={lowCut}
                      min={20}
                      max={2000}
                      defaultValue={80}
                      size={36}
                      neonColor={scFilter ? '#2196f3' : '#64748b'}
                      label="Sidechain Low Cut"
                      onChange={(v) => setParam('lowCut', v)}
                    />
                    <span className="text-[9.5px] font-mono-tabular text-slate-300">
                      {scFilter ? `${Math.round(lowCut)} Hz` : 'Disabled'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setParam('scSwap', scSwap ? 0 : 1)}
                    className={`px-2 py-1.5 rounded text-[10px] border flex flex-col items-center gap-0.5 ${
                      scSwap
                        ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                        : 'bg-[#36383d] text-slate-200 border-[#222428]'
                    }`}
                  >
                    <svg width="16" height="10" viewBox="0 0 16 10" className="stroke-current fill-none">
                      <path d="M1 9 L5 2 L11 2 L15 9" strokeWidth="1.4" />
                    </svg>
                    <span>Swap</span>
                  </button>

                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[10.5px] text-[#d4d6db]">High Cut</span>
                    <RotaryKnob
                      value={highCut}
                      min={1000}
                      max={20000}
                      defaultValue={12000}
                      size={36}
                      neonColor={scFilter ? '#2196f3' : '#64748b'}
                      label="Sidechain High Cut"
                      onChange={(v) => setParam('highCut', v)}
                    />
                    <span className="text-[9.5px] font-mono-tabular text-slate-300">
                      {scFilter ? `${(highCut / 1000).toFixed(1)}k` : 'Disabled'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Global Mix */}
              <div className="bg-[#5a5c61] rounded border border-[#2d2f33] p-2.5 flex flex-col items-center justify-between">
                <div className="text-[13px] font-normal text-[#d8dadf] self-start leading-none">Global</div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[11px] text-[#d4d6db]">Mix</span>
                  <RotaryKnob
                    value={mix}
                    min={0}
                    max={100}
                    defaultValue={81.0}
                    size={42}
                    neonColor="#2196f3"
                    label="Mix"
                    onChange={(v) => setParam('mix', v)}
                  />
                  <span className="text-[11px] font-mono-tabular text-white">
                    {mix.toFixed(1)} %
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
