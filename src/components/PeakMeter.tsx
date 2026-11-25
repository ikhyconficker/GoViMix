import React from 'react';

interface PeakMeterProps {
  left: number; // 0..1
  right: number; // 0..1
  peakHoldLeft?: number; // 0..1
  peakHoldRight?: number; // 0..1
  clipped: boolean;
  neonColor?: string;
  onResetClip: () => void;
}

export const PeakMeter: React.FC<PeakMeterProps> = ({
  left,
  right,
  peakHoldLeft,
  peakHoldRight,
  clipped,
  neonColor = 'var(--theme-neon)',
  onResetClip,
}) => {
  const channels = [
    { lvl: left, hold: peakHoldLeft },
    { lvl: right, hold: peakHoldRight },
  ];

  return (
    <div className="flex flex-col items-center h-[168px] w-[14px] shrink-0 select-none">
      {/* Clip LED */}
      <button
        type="button"
        onClick={onResetClip}
        title="Click to reset Clip LED"
        className={`w-full h-1.5 rounded-[1px] mb-1 transition-colors ${
          clipped
            ? 'bg-rose-500 shadow-[0_0_8px_#ff3b5c]'
            : 'bg-slate-800/90 hover:bg-slate-700'
        }`}
      />

      {/* Dual L / R Bars */}
      <div className="flex gap-[2px] w-full flex-1 bg-[#05070b] p-[1.5px] rounded-[2px] border border-white/10">
        {channels.map(({ lvl, hold }, idx) => {
          const clampedLvl = Math.max(0, Math.min(1, lvl));
          const clampedHold = hold !== undefined ? Math.max(0, Math.min(1, hold)) : 0;
          return (
            <div key={idx} className="relative flex-1 h-full bg-[#0a0d14] overflow-hidden rounded-[1px]">
              <div
                className="absolute bottom-0 left-0 right-0 will-change-[height]"
                style={{
                  height: `${clampedLvl * 100}%`,
                  background: `linear-gradient(to top, ${neonColor} 0%, var(--theme-meter-mid) 62%, #f59e0b 85%, #ff3b5c 97%)`,
                  boxShadow: clampedLvl > 0.05 ? `0 0 6px rgba(var(--theme-neon-rgb), 0.55)` : 'none',
                }}
              />
              {hold !== undefined && clampedHold > 0.015 && (
                <div
                  className="absolute left-0 right-0 h-[1.5px] pointer-events-none"
                  style={{
                    bottom: `calc(${clampedHold * 100}% - 1.5px)`,
                    backgroundColor: clampedHold >= 0.9 ? '#ff3b5c' : 'var(--theme-neon-soft)',
                    boxShadow: `0 0 4px rgba(var(--theme-neon-rgb), 0.75)`,
                  }}
                />
              )}
              {/* Subtle segment grid overlay */}
              <div
                className="absolute inset-0 pointer-events-none opacity-35"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, #05070b 3px, #05070b 4px)',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
