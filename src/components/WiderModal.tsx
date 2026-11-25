import React, { useEffect, useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { audioEngine, linearToDb } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';

interface WiderModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

export const WiderModal: React.FC<WiderModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const scopeRef = useRef<HTMLCanvasElement | null>(null);
  const [outDbL, setOutDbL] = useState(-60);
  const [outDbR, setOutDbR] = useState(-60);

  const p = plugin.params;
  const getVal = (key: string, fallback: number) => (p[key] !== undefined ? p[key] : fallback);

  // Image 2 scale: Gain -24..0, Width 0..3.0 (also sync legacy width % = width * 100)
  const gainDb = getVal('gain', 0.0);
  const widthFactor = getVal('widthFactor', (p.width ?? 135) / 100);
  const asymmetry = getVal('asymmetry', 0);
  const rotation = getVal('rotation', 0);
  const inputModeMs = getVal('inputModeMs', 0) === 1;
  const meterModeMs = getVal('meterModeMs', 0) === 1;
  const phaseL = getVal('phaseL', 0) === 1;
  const phaseR = getVal('phaseR', 0) === 1;
  const swapLR = getVal('swapLR', 0) === 1;

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => {
      const next = { ...prev.params, [key]: val };
      if (key === 'widthFactor') {
        next.width = Number((val * 100).toFixed(0));
      }
      return { ...prev, params: next };
    });
  };

  useEffect(() => {
    let raf = 0;
    const render = () => {
      const metrics = audioEngine.getChannelStereoMetrics(channel.id);
      const valA = meterModeMs ? metrics.midRms : metrics.peakL;
      const valB = meterModeMs ? metrics.sideRms : metrics.peakR;
      const dbA = linearToDb(valA * Math.pow(10, gainDb / 20));
      const dbB = linearToDb(valB * Math.pow(10, gainDb / 20));
      setOutDbL(dbA);
      setOutDbR(dbB);

      const canvas = scopeRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Dark CRT background with subtle grid texture
          const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
          bgGrad.addColorStop(0, '#102430');
          bgGrad.addColorStop(0.6, '#0a1822');
          bgGrad.addColorStop(1, '#060c12');
          ctx.fillStyle = bgGrad;
          ctx.fillRect(0, 0, w, h);

          // Fine dot grid
          ctx.fillStyle = 'rgba(125, 211, 252, 0.06)';
          for (let gx = 4; gx < w; gx += 6) {
            for (let gy = 4; gy < h - 18; gy += 6) {
              ctx.fillRect(gx, gy, 1, 1);
            }
          }

          const cx = w / 2;
          const baseY = h - 20;

          // Concentric blue polar arcs
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
          ctx.lineWidth = 1;
          for (const r of [38, 76, 114, 152, 190]) {
            ctx.beginPath();
            ctx.arc(cx, baseY, r, Math.PI, 0);
            ctx.stroke();
          }

          // Vertical center M axis
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, baseY);
          ctx.lineTo(cx, 12);
          ctx.stroke();

          // Dynamic stereo spread cone based on Width (0..3), Asymmetry (-90..90), Rotation (-45..45)
          const spreadHalfAngle = Math.min(Math.PI * 0.48, (widthFactor / 3) * (Math.PI * 0.42) + 0.08);
          const rotRad = (rotation * Math.PI) / 180;
          const asymRad = (asymmetry * Math.PI) / 360;
          const leftAngle = -Math.PI / 2 - spreadHalfAngle + rotRad + asymRad;
          const rightAngle = -Math.PI / 2 + spreadHalfAngle + rotRad - asymRad;

          const coneLen = 188;
          const lx = cx + Math.cos(leftAngle) * coneLen;
          const ly = baseY + Math.sin(leftAngle) * coneLen;
          const rx = cx + Math.cos(rightAngle) * coneLen;
          const ry = baseY + Math.sin(rightAngle) * coneLen;

          // Translucent stereo field wedge
          ctx.beginPath();
          ctx.moveTo(cx, baseY);
          ctx.lineTo(Math.max(0, lx), Math.max(8, ly));
          ctx.lineTo(Math.min(w, rx), Math.max(8, ry));
          ctx.closePath();
          ctx.fillStyle = plugin.enabled ? 'rgba(99, 102, 241, 0.38)' : 'rgba(100, 116, 139, 0.2)';
          ctx.fill();

          ctx.strokeStyle = 'rgba(226, 232, 240, 0.88)';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Live stereo audio pulse overlay
          const audioEnergy = Math.min(1, (metrics.rmsL + metrics.rmsR) * 2.5);
          if (audioEnergy > 0.01 && plugin.enabled) {
            const liveR = 26 + audioEnergy * 130;
            const lpx = cx + Math.cos(leftAngle) * liveR;
            const lpy = baseY + Math.sin(leftAngle) * liveR;
            const rpx = cx + Math.cos(rightAngle) * liveR;
            const rpy = baseY + Math.sin(rightAngle) * liveR;
            ctx.beginPath();
            ctx.moveTo(cx, baseY);
            ctx.lineTo(lpx, lpy);
            ctx.lineTo(rpx, rpy);
            ctx.closePath();
            ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
            ctx.fill();
          }

          // Bottom horizontal bar & scale labels
          ctx.fillStyle = '#05080d';
          ctx.fillRect(0, h - 18, w, 18);
          ctx.fillStyle = '#cbd5e1';
          ctx.font = '10px ui-monospace, monospace';
          ctx.textAlign = 'center';
          const scaleLabels = ['0', '-6', '-12', '-18', '-24', '-18', '-12', '-6', '0'];
          scaleLabels.forEach((lbl, idx) => {
            const x = 14 + (idx / (scaleLabels.length - 1)) * (w - 28);
            ctx.fillText(lbl, x, h - 5);
          });
        }
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [asymmetry, channel.id, gainDb, meterModeMs, plugin.enabled, rotation, widthFactor]);

  const normToMeter = (db: number) => Math.max(0, Math.min(1, (db + 30) / 30));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[680px] rounded bg-[#202328] border border-black shadow-[0_28px_90px_rgba(0,0,0,0.9)] overflow-hidden select-none"
      >
        {/* Top Modal Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#1b1e23] border-b border-black">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1 rounded border ${
                plugin.enabled
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/60'
                  : 'bg-[#2a2d33] text-slate-500 border-black'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="text-[13px] font-semibold text-white">{plugin.name} · Stereo Imager</span>
            <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-black/50 text-cyan-300 border border-white/10">
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

        {/* Classic Brushed Silver Faceplate (Image 2) */}
        <div
          className="grid grid-cols-[124px_1fr_118px] text-[#1f2226] border-t border-white/30"
          style={{
            background: 'linear-gradient(180deg, #c1c3c6 0%, #a9acb0 55%, #999ca0 100%)',
          }}
        >
          {/* Left Faders: Gain & Width + Input Mode */}
          <div className="p-2.5 border-r border-[#6f7276] flex flex-col justify-between items-center shadow-[inset_-1px_0_0_rgba(255,255,255,0.45)]">
            <div className="grid grid-cols-2 gap-2 w-full">
              {/* Gain Fader */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10.5px] font-semibold text-[#1d2024]">Gain</span>
                <div className="relative h-[165px] w-10 flex items-center justify-center">
                  <div className="absolute left-0 top-1 bottom-1 flex flex-col justify-between text-[9px] font-mono-tabular text-[#22252a]">
                    <span>0</span>
                    <span>-12</span>
                    <span>-24</span>
                  </div>
                  <input
                    type="range"
                    min={-24}
                    max={0}
                    step={0.1}
                    value={gainDb}
                    onChange={(e) => setParam('gain', Number(e.target.value))}
                    className="w-[155px] -rotate-90 accent-[#2c3036] cursor-pointer"
                  />
                </div>
                <div className="w-11 text-center text-[10.5px] font-mono-tabular bg-[#d0d2d5] border border-[#5f6368] rounded-[2px] py-0.5 shadow-inner">
                  {gainDb.toFixed(1)}
                </div>
              </div>

              {/* Width Fader */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10.5px] font-semibold text-[#1d2024]">Width</span>
                <div className="relative h-[165px] w-10 flex items-center justify-center">
                  <div className="absolute left-0 top-1 bottom-1 flex flex-col justify-between text-[9px] font-mono-tabular text-[#22252a]">
                    <span>3.0</span>
                    <span>1.5</span>
                    <span>0.0</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={0.05}
                    value={widthFactor}
                    onChange={(e) => setParam('widthFactor', Number(e.target.value))}
                    className="w-[155px] -rotate-90 accent-[#2c3036] cursor-pointer"
                  />
                </div>
                <div className="w-11 text-center text-[10.5px] font-mono-tabular bg-[#d0d2d5] border border-[#5f6368] rounded-[2px] py-0.5 shadow-inner">
                  {widthFactor.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Input Mode & Polarity */}
            <div className="w-full pt-2 flex flex-col items-center gap-1.5">
              <div className="text-[10px] font-semibold text-[#22252a]">— Input Mode —</div>
              <button
                type="button"
                onClick={() => setParam('inputModeMs', inputModeMs ? 0 : 1)}
                className="flex items-center gap-1.5 text-[10px] font-semibold"
              >
                <span className={!inputModeMs ? 'text-black' : 'text-[#555]'}>L - R</span>
                <span className="w-8 h-3.5 rounded-sm bg-[#2a2d32] border border-[#444] p-0.5 flex items-center">
                  <span
                    className={`w-3.5 h-2.5 rounded-[1px] bg-[#c8cacd] transition-transform ${
                      inputModeMs ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </span>
                <span className={inputModeMs ? 'text-black' : 'text-[#555]'}>M - S</span>
              </button>

              <div className="flex items-center border border-[#555] rounded-[2px] overflow-hidden bg-[#b5b7ba] text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setParam('phaseL', phaseL ? 0 : 1)}
                  className={`px-1.5 py-0.5 border-r border-[#666] ${
                    phaseL ? 'bg-[#38bdf8] text-black' : 'hover:bg-white/20'
                  }`}
                  title="Left Polarity Invert"
                >
                  {phaseL ? 'Ø' : '+'}
                </button>
                <button
                  type="button"
                  onClick={() => setParam('swapLR', swapLR ? 0 : 1)}
                  className={`px-2.5 py-0.5 border-r border-[#666] ${
                    swapLR ? 'bg-[#38bdf8] text-black' : 'hover:bg-white/20'
                  }`}
                  title="Swap L/R"
                >
                  ↔
                </button>
                <button
                  type="button"
                  onClick={() => setParam('phaseR', phaseR ? 0 : 1)}
                  className={`px-1.5 py-0.5 ${
                    phaseR ? 'bg-[#38bdf8] text-black' : 'hover:bg-white/20'
                  }`}
                  title="Right Polarity Invert"
                >
                  {phaseR ? 'Ø' : '+'}
                </button>
              </div>
            </div>
          </div>

          {/* Center Polar Stereo Scope + Asymmetry & Rotation */}
          <div className="p-2.5 flex flex-col justify-between gap-2.5">
            <div className="rounded border-2 border-[#3a3d42] bg-[#060c12] shadow-[inset_0_2px_12px_rgba(0,0,0,0.85)] overflow-hidden">
              <canvas ref={scopeRef} width={360} height={198} className="w-full h-[198px] block" />
            </div>

            <div className="flex flex-col gap-2 px-1">
              {/* Asymmetry */}
              <div className="grid grid-cols-[66px_1fr_42px] items-center gap-2">
                <span className="text-[11px] font-semibold text-[#1f2226]">Asymmetry</span>
                <div className="flex flex-col">
                  <input
                    type="range"
                    min={-90}
                    max={90}
                    step={1}
                    value={asymmetry}
                    onChange={(e) => setParam('asymmetry', Number(e.target.value))}
                    className="w-full accent-[#2c3036] cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] font-mono-tabular text-[#333] -mt-1">
                    <span>-90</span>
                    <span>0</span>
                    <span>90</span>
                  </div>
                </div>
                <div className="text-center text-[10.5px] font-mono-tabular bg-[#d0d2d5] border border-[#5f6368] rounded-[2px] py-0.5">
                  {asymmetry.toFixed(0)}
                </div>
              </div>

              {/* Rotation */}
              <div className="grid grid-cols-[66px_1fr_42px] items-center gap-2">
                <span className="text-[11px] font-semibold text-[#1f2226]">Rotation</span>
                <div className="flex flex-col">
                  <input
                    type="range"
                    min={-45}
                    max={45}
                    step={0.5}
                    value={rotation}
                    onChange={(e) => setParam('rotation', Number(e.target.value))}
                    className="w-full accent-[#2c3036] cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] font-mono-tabular text-[#333] -mt-1">
                    <span>-45</span>
                    <span>0</span>
                    <span>45</span>
                  </div>
                </div>
                <div className="text-center text-[10.5px] font-mono-tabular bg-[#d0d2d5] border border-[#5f6368] rounded-[2px] py-0.5">
                  {rotation.toFixed(1)}
                </div>
              </div>
            </div>
          </div>

          {/* Right Output Stereo Meters + Meter Mode */}
          <div className="p-2.5 border-l border-[#6f7276] flex flex-col justify-between items-center shadow-[inset_1px_0_0_rgba(255,255,255,0.45)]">
            <div className="text-[10.5px] font-semibold text-[#1d2024]">— Output —</div>

            <div className="flex items-stretch gap-1.5 h-[175px]">
              {/* Left Meter Bar */}
              <div className="w-4 rounded-sm bg-[#16191d] border border-[#3d4045] p-0.5 flex flex-col justify-end overflow-hidden">
                <div
                  className="w-full rounded-[1px] transition-all duration-75"
                  style={{
                    height: `${normToMeter(outDbL) * 100}%`,
                    background: 'linear-gradient(to top, #10b981 0%, #38bdf8 70%, #f59e0b 92%, #ef4444 100%)',
                  }}
                />
              </div>

              {/* Center Scale */}
              <div className="flex flex-col justify-between text-[9px] font-mono-tabular text-[#1f2226] py-0.5">
                <span>0</span>
                <span>-6</span>
                <span>-12</span>
                <span>-18</span>
                <span>-24</span>
                <span>-30</span>
              </div>

              {/* Right Meter Bar */}
              <div className="w-4 rounded-sm bg-[#16191d] border border-[#3d4045] p-0.5 flex flex-col justify-end overflow-hidden">
                <div
                  className="w-full rounded-[1px] transition-all duration-75"
                  style={{
                    height: `${normToMeter(outDbR) * 100}%`,
                    background: 'linear-gradient(to top, #10b981 0%, #38bdf8 70%, #f59e0b 92%, #ef4444 100%)',
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 w-full">
              <div className="text-center text-[9.5px] font-mono-tabular bg-[#d0d2d5] border border-[#5f6368] rounded-[2px] py-0.5">
                {outDbL <= -58 ? '-Inf' : outDbL.toFixed(1)}
              </div>
              <div className="text-center text-[9.5px] font-mono-tabular bg-[#d0d2d5] border border-[#5f6368] rounded-[2px] py-0.5">
                {outDbR <= -58 ? '-Inf' : outDbR.toFixed(1)}
              </div>
            </div>

            <div className="w-full flex flex-col items-center gap-1">
              <div className="text-[10px] font-semibold text-[#22252a]">— Meter Mode —</div>
              <button
                type="button"
                onClick={() => setParam('meterModeMs', meterModeMs ? 0 : 1)}
                className="flex items-center gap-1.5 text-[10px] font-semibold"
              >
                <span className={!meterModeMs ? 'text-black' : 'text-[#555]'}>L - R</span>
                <span className="w-8 h-3.5 rounded-sm bg-[#2a2d32] border border-[#444] p-0.5 flex items-center">
                  <span
                    className={`w-3.5 h-2.5 rounded-[1px] bg-[#c8cacd] transition-transform ${
                      meterModeMs ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </span>
                <span className={meterModeMs ? 'text-black' : 'text-[#555]'}>M - S</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
