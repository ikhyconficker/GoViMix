import React, { useEffect, useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { audioEngine, linearToDb } from '../audio/AudioEngine';
import { ChannelState, InsertPlugin } from '../types/mixer';

interface VuMeterModalProps {
  channel: ChannelState;
  plugin: InsertPlugin;
  onClose: () => void;
  onUpdatePlugin: (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => void;
}

const VuDial: React.FC<{ label: string; vuDb: number }> = ({ label, vuDb }) => {
  // Map -20..+3 VU -> -46 deg to +46 deg
  const clamped = Math.max(-20, Math.min(3, vuDb));
  const norm = (clamped + 20) / 23; // 0..1
  const angleDeg = -46 + norm * 92;

  const cx = 140;
  const cy = 195;
  const ticks = [
    { val: -20, text: '20' },
    { val: -10, text: '10' },
    { val: -7, text: '7' },
    { val: -5, text: '5' },
    { val: -3, text: '3' },
    { val: -2, text: '2' },
    { val: -1, text: '1' },
    { val: 0, text: '0' },
    { val: 1, text: '1', red: true },
    { val: 2, text: '2', red: true },
    { val: 3, text: '3', red: true },
  ];

  const valToAngle = (val: number) => ((-46 + ((val + 20) / 23) * 92 - 90) * Math.PI) / 180;

  return (
    <div className="relative rounded-[2px] border-[3px] border-[#3d3a33] shadow-[inset_0_3px_14px_rgba(0,0,0,0.65)] overflow-hidden bg-[#f2dc9b]">
      {/* Warm incandescent backlit dial gradient */}
      <div
        className="w-full aspect-[1.48/1]"
        style={{
          background:
            'radial-gradient(circle at 22% 94%, rgba(255,244,205,0.95) 0%, rgba(240,213,152,0.85) 38%, rgba(208,175,112,0.92) 85%, rgba(162,130,78,0.96) 100%)',
        }}
      >
        <svg viewBox="0 0 280 188" className="w-full h-full block">
          {/* Top-right calibration screw */}
          <circle cx="256" cy="22" r="7" fill="#18191b" stroke="#524d42" strokeWidth="1.5" />
          <circle cx="254" cy="20" r="2.5" fill="#4b4e54" />

          {/* VU Header */}
          <text
            x="38"
            y="45"
            fill="#1f1b16"
            fontSize="16"
            fontWeight="800"
            transform="rotate(-20 38 45)"
            style={{ fontFamily: 'sans-serif' }}
          >
            VU
          </text>

          {/* Main Arc (-20 to 0) */}
          {(() => {
            const a1 = valToAngle(-20);
            const a2 = valToAngle(0);
            const r = 112;
            const x1 = cx + Math.cos(a1) * r;
            const y1 = cy + Math.sin(a1) * r;
            const x2 = cx + Math.cos(a2) * r;
            const y2 = cy + Math.sin(a2) * r;
            return (
              <path
                d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
                fill="none"
                stroke="#221e19"
                strokeWidth="1.8"
              />
            );
          })()}

          {/* Red Overload Arc (0 to +3) */}
          {(() => {
            const a1 = valToAngle(0);
            const a2 = valToAngle(3);
            const r = 110;
            const x1 = cx + Math.cos(a1) * r;
            const y1 = cy + Math.sin(a1) * r;
            const x2 = cx + Math.cos(a2) * r;
            const y2 = cy + Math.sin(a2) * r;
            return (
              <path
                d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
                fill="none"
                stroke="#b9322c"
                strokeWidth="6.5"
              />
            );
          })()}

          {/* Minus / Plus symbols */}
          <text x="34" y="128" fill="#221e19" fontSize="18" fontWeight="800">
            −
          </text>
          <text x="236" y="132" fill="#b9322c" fontSize="16" fontWeight="800">
            +
          </text>

          {/* Scale Ticks & Labels */}
          {ticks.map((t) => {
            const rad = valToAngle(t.val);
            const xIn = cx + Math.cos(rad) * 112;
            const yIn = cy + Math.sin(rad) * 112;
            const xOut = cx + Math.cos(rad) * 124;
            const yOut = cy + Math.sin(rad) * 124;
            const xTxt = cx + Math.cos(rad) * 136;
            const yTxt = cy + Math.sin(rad) * 136;
            return (
              <g key={t.val}>
                <line
                  x1={xIn}
                  y1={yIn}
                  x2={xOut}
                  y2={yOut}
                  stroke={t.red ? '#b9322c' : '#221e19'}
                  strokeWidth="1.8"
                />
                <text
                  x={xTxt}
                  y={yTxt + 4}
                  textAnchor="middle"
                  fill={t.red ? '#b9322c' : '#221e19'}
                  fontSize="13.5"
                  fontWeight="700"
                >
                  {t.text}
                </text>
              </g>
            );
          })}

          {/* Percentage lower scale labels */}
          {[
            { val: -14, text: '20' },
            { val: -8, text: '40' },
            { val: -4.4, text: '60' },
            { val: -1.9, text: '80' },
            { val: 0, text: '100' },
          ].map((p) => {
            const rad = valToAngle(p.val);
            const xt = cx + Math.cos(rad) * 94;
            const yt = cy + Math.sin(rad) * 94;
            return (
              <text
                key={p.text}
                x={xt}
                y={yt + 3}
                textAnchor="middle"
                fill="#4a4033"
                fontSize="9"
                fontWeight="600"
              >
                {p.text}
              </text>
            );
          })}

          {/* Classic Center Wave Emblem + Channel Label */}
          <g transform="translate(120, 128)" opacity="0.82">
            <path
              d="M2 0 L10 18 L18 4 L26 18 L34 0 L38 0 L28 24 L18 10 L8 24 L0 0 Z"
              fill="#221e19"
            />
            <text x="19" y="34" textAnchor="middle" fill="#221e19" fontSize="8" fontWeight="700">
              {label}
            </text>
          </g>

          {/* Animated Needle */}
          <g transform={`rotate(${angleDeg} ${cx} ${cy})`}>
            <line
              x1={cx}
              y1={cy}
              x2={cx}
              y2={cy - 146}
              stroke="rgba(0,0,0,0.22)"
              strokeWidth="3.5"
              transform="translate(2, 2)"
            />
            <line x1={cx} y1={cy} x2={cx} y2={cy - 146} stroke="#1a1714" strokeWidth="2.3" />
          </g>
        </svg>
      </div>
    </div>
  );
};

export const VuMeterModal: React.FC<VuMeterModalProps> = ({
  channel,
  plugin,
  onClose,
  onUpdatePlugin,
}) => {
  const [sizeMode, setSizeMode] = useState<'S' | 'M' | 'L'>('L');
  const [vuL, setVuL] = useState(-20);
  const [vuR, setVuR] = useState(-20);
  const smoothLRef = useRef(-20);
  const smoothRRef = useRef(-20);

  const headroom = plugin.params.headroom ?? 12;
  const delayMs = plugin.params.delayMs ?? 0;

  const setParam = (key: string, val: number) => {
    onUpdatePlugin(channel.id, plugin.id, (prev) => ({
      ...prev,
      params: { ...prev.params, [key]: val },
    }));
  };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const metrics = audioEngine.getChannelStereoMetrics(channel.id);
      const dbL = plugin.enabled ? linearToDb(metrics.rmsL) + headroom : -20;
      const dbR = plugin.enabled ? linearToDb(metrics.rmsR) + headroom : -20;

      const targetL = Math.max(-20, Math.min(3, dbL));
      const targetR = Math.max(-20, Math.min(3, dbR));

      // Classic 300ms VU ballistics smoothing
      smoothLRef.current += (targetL - smoothLRef.current) * 0.14;
      smoothRRef.current += (targetR - smoothRRef.current) * 0.14;

      setVuL(smoothLRef.current);
      setVuR(smoothRRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [channel.id, headroom, plugin.enabled]);

  const maxWClass =
    sizeMode === 'S' ? 'max-w-[460px]' : sizeMode === 'M' ? 'max-w-[580px]' : 'max-w-[700px]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWClass} rounded bg-[#14171c] border border-black shadow-[0_28px_90px_rgba(0,0,0,0.95)] overflow-hidden select-none text-slate-200 transition-all`}
      >
        {/* Top Control Bar (Image 5) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1 bg-[#0b0d10] border-b border-black text-[10.5px]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onUpdatePlugin(channel.id, plugin.id, (prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`p-1 rounded border ${
                plugin.enabled
                  ? 'bg-amber-500/20 text-amber-300 border-amber-400/60'
                  : 'bg-[#22252b] text-slate-500 border-black'
              }`}
            >
              <Power className="w-3 h-3" />
            </button>

            {/* S M L */}
            <div className="flex items-center border border-[#2c3037] rounded-sm overflow-hidden">
              {(['S', 'M', 'L'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setSizeMode(sz)}
                  className={`px-1.5 py-0.5 font-bold ${
                    sizeMode === sz
                      ? 'bg-[#f59e0b] text-black'
                      : 'bg-[#1a1d22] text-slate-300 hover:bg-[#2a2e36]'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>

            {/* HEADROOM */}
            <div className="flex items-center bg-[#d4d6d9] text-[#111] rounded-[2px] border border-[#333] overflow-hidden">
              <span className="px-1.5 py-0.5 font-semibold text-[10px]">HEADROOM</span>
              <span className="px-1.5 font-mono-tabular font-bold">{headroom}</span>
              <div className="flex flex-col border-l border-[#888]">
                <button
                  type="button"
                  onClick={() => setParam('headroom', Math.min(24, headroom + 1))}
                  className="px-1 leading-none text-[8px] hover:bg-black/15"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => setParam('headroom', Math.max(4, headroom - 1))}
                  className="px-1 leading-none text-[8px] hover:bg-black/15"
                >
                  ▼
                </button>
              </div>
            </div>

            {/* DELAY */}
            <div className="flex items-center bg-[#d4d6d9] text-[#111] rounded-[2px] border border-[#333] overflow-hidden">
              <span className="px-1.5 py-0.5 font-semibold text-[10px]">DELAY</span>
              <span className="px-1.5 font-mono-tabular font-bold">{delayMs} ms</span>
              <div className="flex flex-col border-l border-[#888]">
                <button
                  type="button"
                  onClick={() => setParam('delayMs', Math.min(200, delayMs + 5))}
                  className="px-1 leading-none text-[8px] hover:bg-black/15"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => setParam('delayMs', Math.max(0, delayMs - 5))}
                  className="px-1 leading-none text-[8px] hover:bg-black/15"
                >
                  ▼
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono-tabular text-amber-300">
              VU · {channel.name || `Ch ${channel.index}`}
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

        {/* Dark Metallic Recessed Housing with Dual Analog VU Meters */}
        <div
          className="p-4 border-t border-white/10"
          style={{
            background: 'linear-gradient(180deg, #2b2f37 0%, #1c1f25 50%, #121519 100%)',
          }}
        >
          <div className="grid grid-cols-2 gap-3 p-2.5 rounded-sm bg-[#101216] border border-[#383d47] shadow-[inset_0_8px_24px_rgba(0,0,0,0.9)]">
            <VuDial label="LEFT" vuDb={vuL} />
            <VuDial label="RIGHT" vuDb={vuR} />
          </div>
        </div>
      </div>
    </div>
  );
};
