import React from 'react';
import { ArrangementClip, ChannelState, TransportState } from '../types/mixer';

interface ArrangementViewProps {
  channels: ChannelState[];
  clips: ArrangementClip[];
  transport: TransportState;
  selectedChannelId: string;
  onSelectChannel: (id: string) => void;
  onSeek: (sec: number) => void;
}

export const ArrangementView: React.FC<ArrangementViewProps> = ({
  channels,
  clips,
  transport,
  selectedChannelId,
  onSelectChannel,
  onSeek,
}) => {
  const audioChannels = channels.filter((c) => c.type === 'audio');
  const totalTimelineSec = 20;
  const pxPerSec = 58;
  const trackWidth = totalTimelineSec * pxPerSec;

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    onSeek(Number((x / pxPerSec).toFixed(2)));
  };

  return (
    <div className="h-[225px] bg-[#090c12] border-b border-[#1e2636] flex overflow-hidden shrink-0 select-none">
      {/* Left Track Headers */}
      <div className="w-[180px] shrink-0 border-r border-[#1e2636] flex flex-col bg-[#0c1018]">
        <div className="h-[24px] px-3 border-b border-[#1e2636] flex items-center text-[10px] font-semibold text-slate-400">
          Tracks
        </div>
        <div className="flex-1 overflow-y-auto console-scroll">
          {audioChannels.map((ch) => (
            <div
              key={ch.id}
              onClick={() => onSelectChannel(ch.id)}
              className={`h-[32px] px-2.5 border-b border-[#171d29] flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                selectedChannelId === ch.id ? 'bg-[#162030]' : 'hover:bg-[#111622]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-1.5 h-4 rounded-sm shrink-0"
                  style={{
                    backgroundColor: ch.stripColor,
                    boxShadow: `0 0 6px ${ch.neonAccent}`,
                  }}
                />
                <span className="text-[11px] font-semibold text-slate-200 truncate">
                  {ch.name || `Channel ${ch.index}`}
                </span>
              </div>
              <span className="text-[9.5px] font-mono-tabular text-slate-500">Ch {ch.index}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline Grid + Clips */}
      <div className="flex-1 overflow-x-auto overflow-y-auto console-scroll relative bg-[#080a0f]">
        <div style={{ width: trackWidth }} className="relative min-w-full">
          {/* Bar Ruler */}
          <div
            onClick={handleRulerClick}
            className="h-[24px] border-b border-[#1e2636] bg-[#0d111a] relative cursor-pointer"
          >
            {/* Loop Region Overlay */}
            {transport.isLooping && (
              <div
                className="absolute top-0 h-1.5 bg-cyan-400/70"
                style={{
                  left: transport.loopStartSec * pxPerSec,
                  width: (transport.loopEndSec - transport.loopStartSec) * pxPerSec,
                }}
              />
            )}
            {Array.from({ length: totalTimelineSec + 1 }).map((_, sec) => (
              <div
                key={sec}
                className="absolute top-0 bottom-0 border-l border-white/10 pl-1 flex items-center text-[9.5px] font-mono-tabular text-slate-400"
                style={{ left: sec * pxPerSec }}
              >
                {sec}s
              </div>
            ))}
          </div>

          {/* Track Lanes */}
          <div className="relative">
            {audioChannels.map((ch) => {
              const trackClips = clips.filter((c) => c.channelId === ch.id);
              return (
                <div
                  key={ch.id}
                  className="h-[32px] border-b border-[#141a24] relative"
                  style={{
                    backgroundImage: `repeating-linear-gradient(to right, transparent 0px, transparent ${
                      pxPerSec - 1
                    }px, rgba(255,255,255,0.03) ${pxPerSec - 1}px, rgba(255,255,255,0.03) ${pxPerSec}px)`,
                  }}
                >
                  {trackClips.map((clip) => (
                    <div
                      key={clip.id}
                      className="absolute top-1 bottom-1 rounded-[3px] overflow-hidden border flex flex-col justify-between px-1.5 py-0.5"
                      style={{
                        left: clip.startSec * pxPerSec,
                        width: Math.max(40, clip.durationSec * pxPerSec),
                        backgroundColor: `${clip.color}22`,
                        borderColor: `${clip.color}88`,
                      }}
                    >
                      <span className="text-[9px] font-semibold text-white/90 truncate leading-none z-10">
                        {clip.name}
                      </span>
                      {/* Waveform Bars */}
                      <div className="flex items-center gap-[1px] h-3.5 opacity-85">
                        {clip.peaks.map((pk, idx) => (
                          <div
                            key={idx}
                            className="flex-1 rounded-full"
                            style={{
                              height: `${Math.max(18, pk * 100)}%`,
                              backgroundColor: clip.color,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-cyan-400 pointer-events-none z-20"
              style={{
                left: transport.currentTimeSec * pxPerSec,
                boxShadow: '0 0 8px #00e5ff',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
