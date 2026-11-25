import React from 'react';

interface PeakMeterProps {
  left: number; // 0..1
  right: number; // 0..1
  clipped: boolean;
  neonColor?: string;
  onResetClip: () => void;
}

export const PeakMeter: React.FC<PeakMeterProps> = ({
  left,
  right,
  clipped,
  neonColor = '#00f5a0',
  onResetClip,
}) => {
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
        {[left, right].map((lvl, idx) => (
          <div key={idx} className="relative flex-1 h-full bg-[#0a0d14] overflow-hidden rounded-[1px]">
            <div
              className="absolute bottom-0 left-0 right-0 transition-[height] duration-75 ease-out"
              style={{
                height: `${Math.max(0, Math.min(100, lvl * 100))}%`,
                background: `linear-gradient(to top, ${neonColor} 0%, #00e5ff 62%, #fbbf24 85%, #ff3b5c 97%)`,
                boxShadow: lvl > 0.05 ? `0 0 6px ${neonColor}88` : 'none',
              }}
            />
            {/* Subtle segment grid overlay */}
            <div
              className="absolute inset-0 pointer-events-none opacity-35"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, #05070b 3px, #05070b 4px)',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
