import React, { useRef } from 'react';

interface NeonFaderProps {
  valueDb: number; // -60 to +10
  neonColor?: string;
  isFx?: boolean;
  onChange: (db: number) => void;
}

const SCALE_MARKS = [
  { db: 10, label: '10' },
  { db: 0, label: '0' },
  { db: -6, label: '-6' },
  { db: -12, label: '-12' },
  { db: -24, label: '-24' },
  { db: -36, label: '-36' },
  { db: -48, label: '-48' },
  { db: -60, label: '-60' },
];

// Non-linear DAW fader curve so 0dB sits cleanly in the upper ~75% like Studio One
export function dbToFaderPos(db: number): number {
  const clamped = Math.max(-60, Math.min(10, db));
  if (clamped >= 0) {
    return 0.76 + (clamped / 10) * 0.24;
  }
  return 0.76 * Math.pow((clamped + 60) / 60, 1.35);
}

export function faderPosToDb(pos: number): number {
  const p = Math.max(0, Math.min(1, pos));
  if (p >= 0.76) {
    return Number((((p - 0.76) / 0.24) * 10).toFixed(1));
  }
  const db = -60 + 60 * Math.pow(p / 0.76, 1 / 1.35);
  return Number(db.toFixed(1));
}

export const NeonFader: React.FC<NeonFaderProps> = ({
  valueDb,
  neonColor = '#00e5ff',
  isFx = false,
  onChange,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const pos = dbToFaderPos(valueDb); // 0 bottom .. 1 top

  const updateFromClientY = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const usableHeight = rect.height - 28; // cap height padding
    const relY = clientY - (rect.top + 14);
    const norm = 1 - Math.max(0, Math.min(1, relY / usableHeight));
    onChange(faderPosToDb(norm));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updateFromClientY(e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    updateFromClientY(e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const step = e.shiftKey ? 0.2 : 0.8;
    const dir = e.deltaY < 0 ? 1 : -1;
    onChange(Number(Math.max(-60, Math.min(10, valueDb + dir * step)).toFixed(1)));
  };

  return (
    <div
      className="relative flex items-stretch justify-center h-[168px] w-full select-none"
      onWheel={handleWheel}
    >
      {/* Left dB scale */}
      <div className="relative w-6 h-full mr-0.5 pointer-events-none">
        {SCALE_MARKS.map((mark) => {
          const p = dbToFaderPos(mark.db);
          return (
            <div
              key={mark.db}
              className="absolute right-0 flex items-center gap-0.5 -translate-y-1/2"
              style={{ bottom: `calc(${p * 100}% - ${p * 24 - 12}px)` }}
            >
              <span
                className={`text-[9px] font-mono-tabular leading-none ${
                  mark.db === 0 ? 'text-cyan-300 font-semibold' : 'text-slate-400/80'
                }`}
              >
                {mark.label}
              </span>
              <span
                className={`block h-px ${
                  mark.db === 0 ? 'w-1.5 bg-cyan-400/80' : 'w-1 bg-slate-500/60'
                }`}
              />
            </div>
          );
        })}
      </div>

      {/* Fader Track & Cap */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => onChange(0.0)}
        title={`Fader: ${valueDb <= -59.5 ? '-∞' : valueDb.toFixed(1)} dB (Double-click for 0.0 dB)`}
        className="relative w-7 h-full flex items-center justify-center cursor-ns-resize"
      >
        {/* Recessed Track Slot */}
        <div className="relative w-1.5 h-[calc(100%-16px)] rounded-full bg-[#06080c] border border-white/10 overflow-hidden shadow-inner">
          {/* Glowing Neon Fill */}
          <div
            className="absolute bottom-0 left-0 right-0 rounded-full transition-[opacity] duration-100"
            style={{
              height: `${pos * 100}%`,
              background: `linear-gradient(to top, ${neonColor}33, ${neonColor})`,
              boxShadow: `0 0 8px ${neonColor}`,
            }}
          />
        </div>

        {/* 0 dB unity tick across slot */}
        <div
          className="absolute left-0.5 right-0.5 h-px bg-cyan-400/40 pointer-events-none"
          style={{ bottom: `calc(${dbToFaderPos(0) * 100}% - ${dbToFaderPos(0) * 24 - 12}px)` }}
        />

        {/* Machined Neon Fader Cap */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 w-[22px] h-[30px] rounded-[3px] border pointer-events-none flex flex-col items-center justify-center ${
            isFx
              ? 'border-sky-300/60 bg-gradient-to-b from-sky-400/80 via-blue-700/90 to-slate-900'
              : 'fader-cap-surface border-slate-400/40'
          }`}
          style={{
            bottom: `calc(${pos * 100}% - ${pos * 30}px)`,
            boxShadow: `0 4px 12px rgba(0,0,0,0.85), 0 0 10px ${neonColor}44`,
          }}
        >
          {/* Grip ridges */}
          <div className="w-3.5 h-px bg-white/15 mb-1" />
          <div className="w-3.5 h-px bg-white/15 mb-1" />
          {/* Glowing Neon Center Slit */}
          <div
            className="w-4 h-[2.5px] rounded-full"
            style={{
              backgroundColor: '#ffffff',
              boxShadow: `0 0 6px 1px ${neonColor}, 0 0 12px ${neonColor}`,
            }}
          />
          <div className="w-3.5 h-px bg-black/60 mt-1" />
          <div className="w-3.5 h-px bg-white/10 mt-1" />
        </div>
      </div>
    </div>
  );
};
