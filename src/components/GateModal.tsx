import React, { useEffect, useRef, useState } from 'react';
import { Music, Power, X } from 'lucide-react';
import { audioEngine, linearToDb } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';
import { RotaryKnob } from './RotaryKnob';

interface GateModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

const GATE_SCALE_TICKS = [0, -6, -12, -18, -24, -36, -48];

export const GateModal: React.FC<GateModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const lastAttenRef = useRef(0);
  const [gateAttenDb, setGateAttenDb] = useState(0);

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  const threshold = getVal('threshold', -54.48);
  const range = getVal('range', -8.32);
  const attack = getVal('attack', 30.0);
  const hold = getVal('hold', 50.0);
  const release = getVal('release', 318.8);
  const lowCut = getVal('lowCut', 80);
  const highCut = getVal('highCut', 10000);

  const lookAhead = getVal('lookAhead', 1) === 1;
  const ducking = getVal('ducking', 0) === 1;
  const triggerOn = getVal('triggerOn', 0) === 1;
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

          ctx.fillStyle = '#070a0f';
          ctx.fillRect(0, 0, w, h);

          const padL = 26;
          const padR = 8;
          const padT = 8;
          const padB = 18;
          const gw = w - padL - padR;
          const gh = h - padT - padB;

          const dbToX = (db: number) => padL + ((db + 60) / 60) * gw;
          const dbToY = (db: number) => padT + ((0 - db) / 60) * gh;

          // Grid lines
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

          ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
          ctx.strokeRect(padL, padT, gw, gh);

          // Axis labels
          ctx.fillStyle = '#6da8dc';
          ctx.font = '9.5px ui-monospace, monospace';
          ctx.textAlign = 'right';
          for (const db of GATE_SCALE_TICKS) {
            ctx.fillText(`${db}`, padL - 6, dbToY(db) + 3);
          }
          ctx.textAlign = 'center';
          for (const db of [-48, -36, -24, -12]) {
            ctx.fillText(`${db}`, dbToX(db), padT + gh + 12);
          }

          // Gate transfer curve
          ctx.beginPath();
          ctx.strokeStyle = plugin.enabled ? '#7ea2ba' : '#475569';
          ctx.lineWidth = 2;

          for (let i = 0; i <= 120; i++) {
            const inDb = -60 + (i / 120) * 60;
            let outDb = inDb;
            if (ducking) {
              outDb = inDb >= threshold ? Math.max(-60, inDb + range) : inDb;
            } else {
              outDb = inDb < threshold ? Math.max(-60, inDb + range) : inDb;
            }
            const x = dbToX(inDb);
            const y = dbToY(outDb);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // Real-time audio worklet gate reduction + live input level
          const workletAtten = plugin.enabled ? audioEngine.getChannelGateAttenuation(channel.id) : 0;
          const metrics = audioEngine.getChannelStereoMetrics(channel.id);
          const inDb = Math.max(-60, Math.min(0, linearToDb(Math.max(metrics.peakL, metrics.peakR))));
          const liveAtten = workletAtten > 0.05
            ? workletAtten
            : plugin.enabled && (ducking ? inDb >= threshold : inDb < threshold) && inDb > -59.5
            ? Math.abs(range)
            : 0;
          if (Math.abs(liveAtten - lastAttenRef.current) >= 0.1) {
            lastAttenRef.current = liveAtten;
            setGateAttenDb(liveAtten);
          }

          // Yellow gate attenuation bar on left of graph (like image 2)
          const attenNorm = Math.min(1, liveAtten / 48);
          ctx.fillStyle = '#111827';
          ctx.fillRect(padL - 4, padT, 3, gh);
          if (attenNorm > 0.01) {
            ctx.fillStyle = '#eab308';
            ctx.fillRect(padL - 4, padT, 3, gh * attenNorm);
          }

          // Draggable Threshold Node
          const thX = dbToX(threshold);
          const thY = dbToY(Math.max(-60, Math.min(0, threshold)));
          ctx.beginPath();
          ctx.fillStyle = plugin.enabled ? '#38bdf8' : '#64748b';
          ctx.strokeStyle = '#e0f2fe';
          ctx.lineWidth = 1.2;
          ctx.arc(thX, thY, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [channel.id, ducking, plugin.enabled, range, threshold]);

  const handleCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padL = 26;
    const padR = 8;
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
        className="w-full max-w-[780px] rounded-md bg-[#232529] border border-[#121417] shadow-[0_28px_90px_rgba(0,0,0,0.92)] overflow-hidden select-none text-slate-200"
      >
        {/* Header */}
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
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="text-[14px] font-semibold tracking-tight text-white">Gate</span>
            <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-black/50 text-[#38bdf8] border border-white/10">
              {plugin.format}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400">
              Atten: <strong className="font-mono-tabular text-amber-300">-{gateAttenDb.toFixed(1)} dB</strong>
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

        {/* Main Studio One / Fender Gate Layout (Image 2) */}
        <div className="grid grid-cols-[118px_1fr_340px] gap-1.5 p-1.5 bg-[#1a1c20]">
          {/* Left Panel: Threshold & Reduction Range */}
          <div className="bg-[#5a5c61] rounded border border-[#2d2f33] py-4 px-2 flex flex-col items-center justify-around gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-[12px] text-[#d4d6db] font-medium">Threshold</span>
              <RotaryKnob
                value={threshold}
                min={-60}
                max={0}
                defaultValue={-54.48}
                size={48}
                neonColor="#2196f3"
                label="Gate Threshold"
                onChange={(v) => setParam('threshold', v)}
              />
              <span className="text-[11px] font-mono-tabular text-white">
                {threshold.toFixed(2)} dB
              </span>
            </div>

            <div className="flex flex-col items-center gap-1.5">
              <span className="text-[12px] text-[#d4d6db] font-medium text-center leading-tight">
                Reduction
                <br />
                Range
              </span>
              <RotaryKnob
                value={range}
                min={-60}
                max={0}
                defaultValue={-8.32}
                size={48}
                neonColor="#2196f3"
                label="Reduction Range"
                onChange={(v) => setParam('range', v)}
              />
              <span className="text-[11px] font-mono-tabular text-white">
                {range.toFixed(2)} dB
              </span>
            </div>
          </div>

          {/* Center Graph Display */}
          <div className="bg-[#080b10] rounded border border-black flex flex-col justify-between overflow-hidden">
            <canvas
              ref={canvasRef}
              width={290}
              height={240}
              onPointerDown={(e) => {
                draggingRef.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                handleCanvasPointer(e);
              }}
              onPointerMove={(e) => {
                if (draggingRef.current) handleCanvasPointer(e);
              }}
              onPointerUp={(e) => {
                draggingRef.current = false;
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                } catch {
                  // ignore
                }
              }}
              className="w-full h-[242px] block cursor-crosshair"
            />

            {/* Bottom Buttons */}
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#0c0f15] border-t border-white/10">
              <button
                type="button"
                onClick={() => setParam('lookAhead', lookAhead ? 0 : 1)}
                className={`px-3 py-0.5 rounded text-[11px] font-medium border ${
                  lookAhead
                    ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                    : 'bg-[#2a2d34] text-slate-300 border-black/60'
                }`}
              >
                Look Ahead
              </button>
              <button
                type="button"
                onClick={() => setParam('ducking', ducking ? 0 : 1)}
                className={`px-3 py-0.5 rounded text-[11px] font-medium border ${
                  ducking
                    ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                    : 'bg-[#24272d] text-slate-400 border-black/60 hover:text-white'
                }`}
              >
                Ducking
              </button>
            </div>
          </div>

          {/* Right Panel: Envelope + Trigger (Top), Sidechain (Bottom) */}
          <div className="flex flex-col gap-1.5">
            {/* Top Row: Envelope + Trigger */}
            <div className="grid grid-cols-[2.1fr_1fr] gap-1.5 flex-1">
              {/* Envelope */}
              <div className="bg-[#5a5c61] rounded border border-[#2d2f33] p-2.5 flex flex-col justify-between">
                <div className="text-[13px] font-normal text-[#d8dadf]">Envelope</div>
                <div className="grid grid-cols-3 gap-1.5 my-1">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[11px] text-[#d4d6db]">Attack</span>
                    <RotaryKnob
                      value={attack}
                      min={0.1}
                      max={100}
                      defaultValue={30.0}
                      size={42}
                      neonColor="#2196f3"
                      label="Attack"
                      onChange={(v) => setParam('attack', v)}
                    />
                    <span className="text-[10.5px] font-mono-tabular text-white">
                      {attack.toFixed(1)} ms
                    </span>
                  </div>

                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[11px] text-[#d4d6db]">Hold</span>
                    <RotaryKnob
                      value={hold}
                      min={0}
                      max={500}
                      defaultValue={50.0}
                      size={34}
                      neonColor="#2196f3"
                      label="Hold"
                      onChange={(v) => setParam('hold', v)}
                    />
                    <span className="text-[10.5px] font-mono-tabular text-white">
                      {hold.toFixed(1)} ms
                    </span>
                  </div>

                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[11px] text-[#d4d6db]">Release</span>
                    <RotaryKnob
                      value={release}
                      min={5}
                      max={1000}
                      defaultValue={318.8}
                      size={42}
                      neonColor="#2196f3"
                      label="Release"
                      onChange={(v) => setParam('release', v)}
                    />
                    <span className="text-[10.5px] font-mono-tabular text-white">
                      {release.toFixed(1)} ms
                    </span>
                  </div>
                </div>
              </div>

              {/* Trigger */}
              <div className="bg-[#5a5c61] rounded border border-[#2d2f33] p-2.5 flex flex-col justify-between items-center">
                <div className="text-[13px] font-normal text-[#d8dadf] self-start">Trigger</div>
                <div className="text-[11px] font-mono-tabular text-slate-300">Note: C 3</div>
                <button
                  type="button"
                  onClick={() => setParam('triggerOn', triggerOn ? 0 : 1)}
                  className={`px-3 py-1.5 rounded border flex flex-col items-center gap-1 transition-colors ${
                    triggerOn
                      ? 'bg-[#0b6ef6] text-white border-[#3b9bff]'
                      : 'bg-[#36383d] text-slate-300 border-[#222428]'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <Power className="w-3 h-3" />
                </button>
                <div className="text-[11px] font-mono-tabular text-slate-300">Velo: 100</div>
              </div>
            </div>

            {/* Bottom Row: Sidechain */}
            <div className="bg-[#5a5c61] rounded border border-[#2d2f33] p-2.5 flex flex-col justify-between gap-2">
              <div className="text-[13px] font-normal text-[#d8dadf] leading-none">Sidechain</div>
              <div className="flex items-center justify-between gap-2">
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
                  <span className="text-[11px] text-[#d4d6db]">Low Cut</span>
                  <RotaryKnob
                    value={lowCut}
                    min={20}
                    max={2000}
                    defaultValue={80}
                    size={40}
                    neonColor={scFilter ? '#2196f3' : '#64748b'}
                    label="Sidechain Low Cut"
                    onChange={(v) => setParam('lowCut', v)}
                  />
                  <span className="text-[10px] font-mono-tabular text-slate-300">
                    {scFilter ? `${Math.round(lowCut)} Hz` : 'Disabled'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setParam('scSwap', scSwap ? 0 : 1)}
                  className={`px-2.5 py-1.5 rounded text-[10.5px] border flex flex-col items-center gap-0.5 ${
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
                  <span className="text-[11px] text-[#d4d6db]">High Cut</span>
                  <RotaryKnob
                    value={highCut}
                    min={1000}
                    max={20000}
                    defaultValue={10000}
                    size={40}
                    neonColor={scFilter ? '#2196f3' : '#64748b'}
                    label="Sidechain High Cut"
                    onChange={(v) => setParam('highCut', v)}
                  />
                  <span className="text-[10px] font-mono-tabular text-slate-300">
                    {scFilter ? `${(highCut / 1000).toFixed(1)}k` : 'Disabled'}
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
