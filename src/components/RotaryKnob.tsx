import React, { useRef } from 'react';

interface RotaryKnobProps {
  value: number;
  min: number;
  max: number;
  defaultValue?: number;
  size?: number;
  neonColor?: string;
  label?: string;
  onChange: (value: number) => void;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  value,
  min,
  max,
  defaultValue = 0,
  size = 28,
  neonColor = 'var(--theme-neon)',
  label,
  onChange,
}) => {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);

  const clamped = Math.max(min, Math.min(max, value));
  const norm = (clamped - min) / (max - min); // 0..1
  const startAngle = -135;
  const endAngle = 135;
  const currentAngle = startAngle + norm * (endAngle - startAngle);

  // Center zero indicator when min < 0 < max
  const isBipolar = min < 0 && max > 0;
  const zeroNorm = isBipolar ? (0 - min) / (max - min) : 0;
  const zeroAngle = startAngle + zeroNorm * (endAngle - startAngle);

  const cx = 18;
  const cy = 18;
  const radius = 13;

  const polarToCartesian = (angleDeg: number, r: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (a1: number, a2: number, r: number) => {
    const p1 = polarToCartesian(a1, r);
    const p2 = polarToCartesian(a2, r);
    const largeArc = Math.abs(a2 - a1) <= 180 ? '0' : '1';
    const sweep = a2 >= a1 ? '1' : '0';
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${p2.x} ${p2.y}`;
  };

  const arcStart = isBipolar ? Math.min(zeroAngle, currentAngle) : startAngle;
  const arcEnd = isBipolar ? Math.max(zeroAngle, currentAngle) : currentAngle;
  const showActiveArc = Math.abs(arcEnd - arcStart) > 1.5;

  const pointerTip = polarToCartesian(currentAngle, 9.5);
  const pointerBase = polarToCartesian(currentAngle, 3.5);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startVal: clamped };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dy = dragRef.current.startY - e.clientY;
    const sensitivity = e.shiftKey ? 0.002 : 0.0065;
    const delta = dy * sensitivity * (max - min);
    const next = Math.max(min, Math.min(max, dragRef.current.startVal + delta));
    onChange(Number(next.toFixed(1)));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : (max - min) / 48;
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = Math.max(min, Math.min(max, clamped + dir * step));
    onChange(Number(next.toFixed(1)));
  };

  return (
    <button
      type="button"
      title={label ? `${label}: ${clamped.toFixed(1)} (Double-click to reset)` : `${clamped.toFixed(1)}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={() => onChange(defaultValue)}
      onWheel={handleWheel}
      className="relative inline-flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-neon)] cursor-ns-resize select-none shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 36 36" className="overflow-visible">
        <defs>
          <radialGradient id="knobCapGrad" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#3b4354" />
            <stop offset="65%" stopColor="#1b202b" />
            <stop offset="100%" stopColor="#0d1017" />
          </radialGradient>
        </defs>
        {/* Background track */}
        <path
          d={describeArc(startAngle, endAngle, radius)}
          fill="none"
          stroke="#1f2736"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {/* Active neon arc */}
        {showActiveArc && (
          <path
            d={describeArc(arcStart, arcEnd, radius)}
            fill="none"
            stroke={neonColor}
            strokeWidth="2.6"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${neonColor})` }}
          />
        )}
        {/* Metallic cap */}
        <circle
          cx={cx}
          cy={cy}
          r={10}
          fill="url(#knobCapGrad)"
          stroke="#333c4f"
          strokeWidth="0.9"
        />
        {/* Neon pointer needle */}
        <line
          x1={pointerBase.x}
          y1={pointerBase.y}
          x2={pointerTip.x}
          y2={pointerTip.y}
          stroke={neonColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 3px ${neonColor})` }}
        />
      </svg>
    </button>
  );
};
