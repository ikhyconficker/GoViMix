import React, { useRef, useState } from 'react';
import {
  AudioWaveform,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FolderOpen,
  Mic,
  Plus,
  Power,
  Radio,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { BUILTIN_SEND_BUSES, PLUGIN_CATALOG } from '../data/defaultSession';
import {
  AsioDriverConfig,
  AudioDeviceInfo,
  AutomationMode,
  ChannelState,
  InputSourceType,
  InsertPlugin,
  MeterReading,
  PluginCatalogItem,
  PluginFormat,
  PluginType,
} from '../types/mixer';
import { NeonFader } from './NeonFader';
import { PeakMeter } from './PeakMeter';
import { RotaryKnob } from './RotaryKnob';

interface ChannelStripProps {
  channel: ChannelState;
  fxBuses: ChannelState[];
  allChannels?: ChannelState[];
  asioConfig?: AsioDriverConfig;
  inputDevices?: AudioDeviceInfo[];
  isSelected: boolean;
  meter: MeterReading;
  canDelete?: boolean;
  onSelect: () => void;
  onUpdate: (updater: (prev: ChannelState) => ChannelState) => void;
  onDeleteChannel?: () => void;
  onOpenPlugin: (channelId: string, plugin: InsertPlugin) => void;
  onResetClip: () => void;
  onLoadFile: (channelId: string, file: File) => void;
  onToggleMic: (channelId: string) => void;
  onSelectInput?: (
    channelId: string,
    source: InputSourceType,
    channelIndex: number,
    label: string,
    deviceId?: string
  ) => void;
}

const AUTO_MODES: AutomationMode[] = ['Off', 'Read', 'Touch', 'Latch', 'Write'];

const FORMAT_BADGE: Record<PluginFormat, { label: string; cls: string }> = {
  VST3: { label: 'V3', cls: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' },
  AAX: { label: 'AAX', cls: 'text-violet-300 border-violet-500/40 bg-violet-500/10' },
  VST2: { label: 'V2', cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
};

function inferPluginTypeFromName(fileName: string): PluginType {
  const lower = fileName.toLowerCase();
  if (lower.includes('eq') || lower.includes('pro-q')) return 'pro-q';
  if (lower.includes('comp') || lower.includes('cla') || lower.includes('ssl')) return 'compressor';
  if (lower.includes('limit') || lower.includes('l2') || lower.includes('ozone')) return 'limiter';
  if (lower.includes('verb') || lower.includes('hall')) return 'reverb';
  if (lower.includes('delay') || lower.includes('echo')) return 'delay';
  if (lower.includes('gate') || lower.includes('ns1')) return 'gate';
  if (lower.includes('mega')) return 'megaphone';
  if (lower.includes('harm') || lower.includes('tune')) return 'harmony';
  return 'pro-eq';
}

export const ChannelStrip: React.FC<ChannelStripProps> = ({
  channel,
  fxBuses,
  allChannels = [],
  asioConfig,
  inputDevices = [],
  isSelected,
  meter,
  canDelete = false,
  onSelect,
  onUpdate,
  onDeleteChannel,
  onOpenPlugin,
  onResetClip,
  onLoadFile,
  onToggleMic,
  onSelectInput,
}) => {
  const [showInputMenu, setShowInputMenu] = useState(false);
  const [activeInputSubmenu, setActiveInputSubmenu] = useState<
    'hardware' | 'bus' | 'internal' | 'application' | null
  >('hardware');
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [insertFormatFilter, setInsertFormatFilter] = useState<'ALL' | PluginFormat>('ALL');
  const [showSendMenu, setShowSendMenu] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(channel.name);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pluginFileRef = useRef<HTMLInputElement | null>(null);
  const panTrackRef = useRef<HTMLDivElement | null>(null);
  const panDragging = useRef(false);

  const isMaster = channel.type === 'master';
  const isListen = channel.type === 'listen';
  const isFx = channel.type === 'fx';
  const isAudio = channel.type === 'audio';

  const stripWidth = isMaster || isListen ? 'w-[104px]' : 'w-[100px]';

  const formatPan = (p: number) => {
    if (Math.abs(p) < 2) return '<C>';
    return p < 0 ? `L${Math.abs(Math.round(p))}` : `R${Math.round(p)}`;
  };

  const updatePanFromClientX = (clientX: number) => {
    const el = panTrackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const norm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const panVal = Math.round((norm * 2 - 1) * 100);
    onUpdate((c) => ({ ...c, pan: Math.abs(panVal) < 4 ? 0 : panVal }));
  };

  const addInsertPlugin = (item: PluginCatalogItem) => {
    const plugin: InsertPlugin = {
      id: `ins-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: item.name,
      format: item.format,
      vendor: item.vendor,
      type: item.type,
      enabled: true,
      params: { ...item.defaultParams },
    };
    onUpdate((c) => ({ ...c, inserts: [...c.inserts, plugin] }));
    setShowInsertMenu(false);
  };

  const handleLoadLocalPluginFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    let format: PluginFormat = 'VST3';
    if (ext === 'aaxplugin' || ext === 'aax') format = 'AAX';
    else if (ext === 'dll' || ext === 'vst') format = 'VST2';

    const baseName = file.name.replace(/\.(vst3|aaxplugin|aax|dll|vst|component)$/i, '');
    const inferredType = inferPluginTypeFromName(baseName);
    const catalogTemplate = PLUGIN_CATALOG.find((p) => p.type === inferredType);

    const plugin: InsertPlugin = {
      id: `ins-local-${Date.now()}`,
      name: baseName,
      format,
      vendor: 'Local Plugin',
      type: inferredType,
      enabled: true,
      bundlePath: file.name,
      params: { ...(catalogTemplate?.defaultParams ?? { lowGain: 0, midGain: 0, highGain: 0 }) },
    };
    onUpdate((c) => ({ ...c, inserts: [...c.inserts, plugin] }));
    setShowInsertMenu(false);
  };

  const availableSendTargets = [
    ...BUILTIN_SEND_BUSES,
    ...fxBuses.map((b) => ({ id: b.id, name: b.name || `FX ${b.index}` })),
  ];

  const addSendBus = (target: { id: string; name: string }) => {
    if (channel.sends.some((s) => s.targetBusId === target.id)) {
      setShowSendMenu(false);
      return;
    }
    onUpdate((c) => ({
      ...c,
      sends: [
        ...c.sends,
        {
          id: `snd-${Date.now()}-${target.id}`,
          targetBusId: target.id,
          targetName: target.name,
          levelDb: -12,
          enabled: true,
          preFader: false,
        },
      ],
    }));
    setShowSendMenu(false);
  };

  const cycleAutomation = () => {
    const idx = AUTO_MODES.indexOf(channel.automationMode);
    const next = AUTO_MODES[(idx + 1) % AUTO_MODES.length];
    onUpdate((c) => ({ ...c, automationMode: next }));
  };

  const cycleInputSource = () => {
    onUpdate((c) => {
      const order: ChannelState['inputSource'][] = ['none', 'demo', 'mic'];
      const idx = order.indexOf(c.inputSource);
      const next = order[(idx + 1) % order.length];
      return { ...c, inputSource: next };
    });
  };

  const allInsertsEnabled = channel.inserts.length > 0 && channel.inserts.some((i) => i.enabled);
  const allSendsEnabled = channel.sends.length > 0 && channel.sends.some((s) => s.enabled);

  const commitRename = () => {
    const clean = draftName.trim();
    onUpdate((c) => ({ ...c, name: clean ? clean.toUpperCase() : '' }));
    setEditingName(false);
  };

  const filteredCatalog =
    insertFormatFilter === 'ALL'
      ? PLUGIN_CATALOG
      : PLUGIN_CATALOG.filter((p) => p.format === insertFormatFilter);

  return (
    <div
      onClick={onSelect}
      className={`group/strip relative flex flex-col shrink-0 h-full border-r border-[#1c2331] transition-colors select-none ${stripWidth}`}
      style={{
        backgroundColor: isSelected ? channel.tintBg : '#0d1017',
        boxShadow: isSelected ? `inset 0 0 0 1px ${channel.neonAccent}66` : undefined,
      }}
    >
      {/* Top Color Strip */}
      <div
        className="relative h-[5px] w-full shrink-0"
        style={{
          backgroundColor: channel.stripColor,
          boxShadow: `0 0 10px ${channel.neonAccent}88`,
        }}
      >
        {canDelete && onDeleteChannel && (
          <button
            type="button"
            title="Remove Channel"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteChannel();
            }}
            className="opacity-0 group-hover/strip:opacity-100 absolute right-0.5 top-1.5 z-20 p-0.5 rounded bg-black/75 text-slate-300 hover:text-rose-400 transition-opacity"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      {/* Section 1: Input Gain + Polarity OR Mix FX Header */}
      {isMaster ? (
        <div className="h-[52px] px-1.5 flex items-center justify-between border-b border-[#1c2331] bg-[#10151f]">
          <span className="text-[11px] font-semibold text-slate-200 tracking-tight">Mix FX</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </div>
      ) : isListen ? (
        <div className="h-[52px] px-1.5 flex items-center justify-center border-b border-[#1c2331] bg-[#10151f]">
          <span className="text-[10px] font-medium text-slate-400">Cue / Listen</span>
        </div>
      ) : (
        <div className="h-[52px] px-1.5 pt-1 pb-1 flex flex-col justify-between border-b border-[#1c2331] bg-[#0f131c]/80">
          <div className="flex items-center justify-between gap-1">
            <RotaryKnob
              value={channel.inputGainDb}
              min={-24}
              max={24}
              defaultValue={0}
              size={26}
              neonColor={channel.neonAccent}
              label={`${channel.name || `Ch ${channel.index}`} Input Gain`}
              onChange={(val) => onUpdate((c) => ({ ...c, inputGainDb: val }))}
            />
            <span className="text-[10px] font-mono-tabular text-slate-200 pr-0.5">
              {channel.inputGainDb.toFixed(1)} dB
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              title="Phase / Polarity L"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate((c) => ({ ...c, polarityLeft: !c.polarityLeft }));
              }}
              className={`h-[14px] rounded-[2px] text-[10px] font-bold flex items-center justify-center border transition-all ${
                channel.polarityLeft
                  ? 'bg-emerald-500/85 text-slate-950 border-emerald-300/60 shadow-[0_0_8px_rgba(16,185,129,0.55)]'
                  : 'bg-[#1a202c] text-slate-400 border-white/10 hover:text-slate-200'
              }`}
            >
              Ø
            </button>
            <button
              type="button"
              title="Phase / Polarity R"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate((c) => ({ ...c, polarityRight: !c.polarityRight }));
              }}
              className={`h-[14px] rounded-[2px] text-[10px] font-bold flex items-center justify-center border transition-all ${
                channel.polarityRight
                  ? 'bg-emerald-500/85 text-slate-950 border-emerald-300/60 shadow-[0_0_8px_rgba(16,185,129,0.55)]'
                  : 'bg-[#1a202c] text-slate-400 border-white/10 hover:text-slate-200'
              }`}
            >
              Ø
            </button>
          </div>
        </div>
      )}

      {/* Input Routing Row (Synced with Selected ASIO & Application Sources) */}
      {isAudio ? (
        <div className="relative h-[22px] px-1 border-b border-[#1c2331] bg-[#0b0f17] flex items-center shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowInputMenu((v) => !v);
              setActiveInputSubmenu('hardware');
              setShowInsertMenu(false);
              setShowSendMenu(false);
            }}
            title={`Input Source · ${asioConfig?.deviceType ?? 'ASIO'}: ${asioConfig?.activeDeviceName ?? 'ASIO4ALL v2'}`}
            className="w-full h-[17px] px-1.5 rounded-[2px] bg-[#131926] hover:bg-[#1a2234] border border-white/10 hover:border-cyan-400/50 flex items-center justify-between gap-1 text-[9.5px] transition-colors"
          >
            <span className="flex items-center gap-1 min-w-0">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  channel.inputSource === 'mic'
                    ? 'bg-rose-400 shadow-[0_0_5px_#fb7185]'
                    : channel.inputSource === 'app'
                    ? 'bg-amber-400 shadow-[0_0_5px_#fbbf24]'
                    : channel.inputSource === 'bus'
                    ? 'bg-violet-400 shadow-[0_0_5px_#a78bfa]'
                    : channel.inputSource === 'demo'
                    ? 'bg-cyan-400 shadow-[0_0_5px_#22d3ee]'
                    : channel.inputSource === 'file'
                    ? 'bg-emerald-400 shadow-[0_0_5px_#34d399]'
                    : 'bg-slate-600'
                }`}
              />
              <span className="truncate text-slate-200 font-medium">
                {(() => {
                  const asioActiveInputs = asioConfig?.activeInputChannels ?? [];
                  const primaryAsioIn = asioActiveInputs[0] ?? `${asioConfig?.activeDeviceName ?? 'ASIO'} In ${channel.inputChannelIndex}`;
                  if (channel.inputSource === 'mic') {
                    if (
                      !channel.inputLabel ||
                      channel.inputLabel.startsWith('ASIO In ')
                    ) {
                      return asioActiveInputs.length > 0
                        ? primaryAsioIn
                        : `${asioConfig?.activeDeviceName ?? 'ASIO'} ${channel.inputChannelIndex}`;
                    }
                    return channel.inputLabel;
                  }
                  if (channel.inputSource === 'file') {
                    return channel.audioFileName ?? channel.inputLabel ?? 'Audio File';
                  }
                  if (channel.inputSource === 'demo') {
                    return channel.inputLabel ?? `Stem In ${channel.index}`;
                  }
                  if (channel.inputSource === 'app' || channel.inputSource === 'bus') {
                    return channel.inputLabel ?? 'Source';
                  }
                  return 'None';
                })()}
              </span>
            </span>
            <ChevronDown className="w-2.5 h-2.5 text-slate-400 shrink-0" />
          </button>

          {showInputMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-[22px] left-0 z-50 flex items-start"
            >
              {/* Primary Cascaded Input Categories */}
              <div className="w-[175px] bg-[#2a2e33] border border-[#454b52] rounded-[3px] shadow-[0_14px_32px_rgba(0,0,0,0.85)] py-1 text-[11.5px] text-[#e4e8ec]">
                <button
                  type="button"
                  onClick={() => {
                    onSelectInput?.(channel.id, 'none', 0, 'None');
                    setShowInputMenu(false);
                  }}
                  className="w-full px-2.5 py-1.5 flex items-center gap-2 hover:bg-[#3e444c] text-left transition-colors"
                >
                  <span className="w-3.5 flex items-center justify-center shrink-0">
                    {channel.inputSource === 'none' && <Check className="w-3.5 h-3.5 text-white" />}
                  </span>
                  <span>None</span>
                </button>

                <button
                  type="button"
                  onMouseEnter={() => setActiveInputSubmenu('hardware')}
                  onClick={() => setActiveInputSubmenu('hardware')}
                  className={`w-full px-2.5 py-1.5 flex items-center justify-between text-left transition-colors ${
                    activeInputSubmenu === 'hardware' ? 'bg-[#3e444c]' : 'hover:bg-[#3e444c]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 flex items-center justify-center shrink-0">
                      {channel.inputSource === 'mic' && <Check className="w-3.5 h-3.5 text-white" />}
                    </span>
                    <span>Hardware</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                </button>

                <button
                  type="button"
                  onMouseEnter={() => setActiveInputSubmenu('bus')}
                  onClick={() => setActiveInputSubmenu('bus')}
                  className={`w-full px-2.5 py-1.5 flex items-center justify-between text-left transition-colors ${
                    activeInputSubmenu === 'bus' ? 'bg-[#3e444c]' : 'hover:bg-[#3e444c]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 flex items-center justify-center shrink-0">
                      {channel.inputSource === 'bus' && <Check className="w-3.5 h-3.5 text-white" />}
                    </span>
                    <span>Bus</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                </button>

                <button
                  type="button"
                  onMouseEnter={() => setActiveInputSubmenu('internal')}
                  onClick={() => setActiveInputSubmenu('internal')}
                  className={`w-full px-2.5 py-1.5 flex items-center justify-between text-left transition-colors ${
                    activeInputSubmenu === 'internal' ? 'bg-[#3e444c]' : 'hover:bg-[#3e444c]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 flex items-center justify-center shrink-0">
                      {(channel.inputSource === 'demo' || channel.inputSource === 'file') && (
                        <Check className="w-3.5 h-3.5 text-white" />
                      )}
                    </span>
                    <span>Internal</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                </button>

                <button
                  type="button"
                  onMouseEnter={() => setActiveInputSubmenu('application')}
                  onClick={() => setActiveInputSubmenu('application')}
                  className={`w-full px-2.5 py-1.5 flex items-center justify-between text-left transition-colors ${
                    activeInputSubmenu === 'application' ? 'bg-[#3e444c]' : 'hover:bg-[#3e444c]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 flex items-center justify-center shrink-0">
                      {channel.inputSource === 'app' && <Check className="w-3.5 h-3.5 text-white" />}
                    </span>
                    <span>Application</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                </button>
              </div>

              {/* Cascaded Submenu Panel */}
              {activeInputSubmenu === 'hardware' && (
                <div className="w-[215px] max-h-64 overflow-y-auto console-scroll bg-[#2a2e33] border border-[#454b52] rounded-[3px] shadow-[0_14px_32px_rgba(0,0,0,0.9)] py-1 -ml-[1px] text-[11px] text-[#e4e8ec]">
                  <div className="px-2.5 py-1 text-[9.5px] font-semibold text-cyan-300 border-b border-white/10">
                    {asioConfig?.deviceType ?? 'ASIO'}: {asioConfig?.activeDeviceName ?? 'ASIO4ALL v2'}
                  </div>

                  {(asioConfig?.activeInputChannels ?? ['HD Audio Mic input 1 + 2']).map(
                    (asioChLabel, idx) => (
                      <button
                        key={asioChLabel}
                        type="button"
                        onClick={() => {
                          onSelectInput?.(
                            channel.id,
                            'mic',
                            idx + 1,
                            asioChLabel,
                            asioConfig?.inputDeviceId
                          );
                          setShowInputMenu(false);
                        }}
                        className="w-full px-2.5 py-1.5 hover:bg-[#3e444c] text-left flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{asioChLabel}</span>
                        {channel.inputSource === 'mic' &&
                          (channel.inputLabel === asioChLabel || channel.inputChannelIndex === idx + 1) && (
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                          )}
                      </button>
                    )
                  )}

                  <div className="px-2.5 pt-1.5 pb-0.5 text-[9px] text-slate-400 border-t border-white/10 mt-1">
                    Channel Routing ({asioConfig?.activeDeviceName ?? 'ASIO'})
                  </div>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((inIdx) => {
                    const label = `${asioConfig?.activeDeviceName ?? 'ASIO'} In ${inIdx}`;
                    return (
                      <button
                        key={inIdx}
                        type="button"
                        onClick={() => {
                          onSelectInput?.(
                            channel.id,
                            'mic',
                            inIdx,
                            label,
                            asioConfig?.inputDeviceId
                          );
                          setShowInputMenu(false);
                        }}
                        className="w-full px-2.5 py-1 hover:bg-[#3e444c] text-left flex items-center justify-between"
                      >
                        <span className="truncate">{label}</span>
                        {channel.inputSource === 'mic' && channel.inputLabel === label && (
                          <Check className="w-3 h-3 text-cyan-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}

                  {inputDevices.length > 0 && (
                    <>
                      <div className="px-2.5 pt-1.5 pb-0.5 text-[9px] text-emerald-300 border-t border-white/10 mt-1">
                        Detected Hardware Inputs
                      </div>
                      {inputDevices.map((dev) => (
                        <button
                          key={dev.deviceId}
                          type="button"
                          onClick={() => {
                            onSelectInput?.(
                              channel.id,
                              'mic',
                              channel.inputChannelIndex || channel.index,
                              dev.label,
                              dev.deviceId
                            );
                            setShowInputMenu(false);
                          }}
                          className="w-full px-2.5 py-1 hover:bg-[#3e444c] text-left truncate block"
                        >
                          {dev.label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}

              {activeInputSubmenu === 'bus' && (
                <div className="w-[185px] max-h-56 overflow-y-auto console-scroll bg-[#2a2e33] border border-[#454b52] rounded-[3px] shadow-[0_14px_32px_rgba(0,0,0,0.9)] py-1 -ml-[1px] text-[11px] text-[#e4e8ec]">
                  <div className="px-2.5 py-1 text-[9.5px] font-semibold text-violet-300 border-b border-white/10">
                    Mixer Bus Routing
                  </div>
                  {(allChannels.length > 0
                    ? allChannels.filter(
                        (c) =>
                          c.id !== channel.id &&
                          (c.type === 'fx' || c.type === 'master' || (c.name && c.type === 'audio'))
                      )
                    : BUILTIN_SEND_BUSES.map((b) => ({ id: b.id, name: b.name }))
                  ).map((bus, idx) => (
                    <button
                      key={bus.id}
                      type="button"
                      onClick={() => {
                        onSelectInput?.(channel.id, 'bus', idx + 1, `Bus: ${bus.name || bus.id}`);
                        setShowInputMenu(false);
                      }}
                      className="w-full px-2.5 py-1.5 hover:bg-[#3e444c] text-left truncate block"
                    >
                      {bus.name || bus.id}
                    </button>
                  ))}
                </div>
              )}

              {activeInputSubmenu === 'internal' && (
                <div className="w-[195px] bg-[#2a2e33] border border-[#454b52] rounded-[3px] shadow-[0_14px_32px_rgba(0,0,0,0.9)] py-1 -ml-[1px] text-[11px] text-[#e4e8ec]">
                  <div className="px-2.5 py-1 text-[9.5px] font-semibold text-cyan-300 border-b border-white/10">
                    Internal Audio Source
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectInput?.(channel.id, 'demo', channel.index, `Stem In ${channel.index}`);
                      setShowInputMenu(false);
                    }}
                    className="w-full px-2.5 py-1.5 hover:bg-[#3e444c] text-left block"
                  >
                    Demo Stem (Synth)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowInputMenu(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full px-2.5 py-1.5 hover:bg-[#3e444c] text-left text-cyan-300 block"
                  >
                    Load Audio File (.wav / .mp3)...
                  </button>
                </div>
              )}

              {activeInputSubmenu === 'application' && (
                <div className="w-[190px] bg-[#2a2e33] border border-[#454b52] rounded-[3px] shadow-[0_14px_32px_rgba(0,0,0,0.9)] py-1 -ml-[1px] text-[11.5px] text-[#e4e8ec]">
                  {[
                    { name: 'Firefox', devId: 'app-firefox' },
                    { name: 'svchost.exe', devId: 'app-svchost' },
                    { name: 'Chrome / Browser Audio', devId: 'app-capture' },
                    { name: 'Capture App / System Audio...', devId: 'app-capture' },
                  ].map((appItem) => (
                    <button
                      key={appItem.name}
                      type="button"
                      onClick={() => {
                        onSelectInput?.(
                          channel.id,
                          'app',
                          channel.index,
                          appItem.name,
                          appItem.devId
                        );
                        setShowInputMenu(false);
                      }}
                      className="w-full px-3 py-1.5 hover:bg-[#3e444c] text-left flex items-center justify-between gap-1 transition-colors"
                    >
                      <span className="truncate">{appItem.name}</span>
                      {channel.inputSource === 'app' && channel.inputLabel === appItem.name && (
                        <Check className="w-3 h-3 text-amber-300 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="h-[22px] px-1.5 border-b border-[#1c2331] bg-[#0b0f17] flex items-center justify-between text-[9.5px] text-slate-500 shrink-0">
          <span>{isMaster ? 'Sum: All Bus' : isListen ? 'Solo / Cue' : 'Bus Input'}</span>
          <span className="font-mono-tabular text-[9px] text-cyan-400/70">St</span>
        </div>
      )}

      {/* Section 2: Inserts Rack (VST3 / AAX / VST2) */}
      <div className="relative flex flex-col h-[142px] border-b border-[#1c2331]">
        <div className="h-[22px] px-1.5 flex items-center justify-between bg-[#131823] border-b border-[#1c2331] shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Bypass/Enable All Inserts"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate((c) => ({
                  ...c,
                  inserts: c.inserts.map((ins) => ({ ...ins, enabled: !allInsertsEnabled })),
                }));
              }}
              className={`p-0.5 rounded transition-colors ${
                allInsertsEnabled ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Power className="w-3 h-3" />
            </button>
            <span className="text-[11px] font-medium text-slate-300">Inserts</span>
          </div>
          <button
            type="button"
            title="Add VST3 / AAX / VST2 Plugin"
            onClick={(e) => {
              e.stopPropagation();
              setShowInsertMenu((v) => !v);
              setShowSendMenu(false);
            }}
            className="p-0.5 rounded text-slate-400 hover:text-cyan-300 hover:bg-white/5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* VST3 / AAX / VST2 Insert Picker Dropdown */}
        {showInsertMenu && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-[22px] left-0 w-[196px] z-40 bg-[#0b0f18] border border-cyan-500/45 rounded shadow-2xl p-1.5"
          >
            {/* Format Tabs */}
            <div className="grid grid-cols-4 gap-1 mb-1.5">
              {(['ALL', 'VST3', 'AAX', 'VST2'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setInsertFormatFilter(fmt)}
                  className={`py-0.5 rounded text-[9px] font-bold border transition-colors ${
                    insertFormatFilter === fmt
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/60'
                      : 'bg-[#121722] text-slate-400 border-white/10 hover:text-white'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            <div className="max-h-44 overflow-y-auto console-scroll space-y-0.5">
              {filteredCatalog.map((item) => {
                const badge = FORMAT_BADGE[item.format];
                return (
                  <button
                    key={`${item.format}-${item.name}`}
                    type="button"
                    onClick={() => addInsertPlugin(item)}
                    className="w-full text-left px-1.5 py-1 text-[10px] text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-200 rounded flex items-center justify-between gap-1.5"
                  >
                    <span className="truncate">{item.name}</span>
                    <span className={`px-1 rounded-[2px] text-[8px] font-bold border shrink-0 ${badge.cls}`}>
                      {item.format}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Load Local .vst3 / .aaxplugin / .dll */}
            <div className="pt-1.5 mt-1.5 border-t border-white/10">
              <button
                type="button"
                onClick={() => pluginFileRef.current?.click()}
                className="w-full py-1 px-1.5 rounded bg-[#151c2b] hover:bg-cyan-500/20 border border-white/10 text-[9.5px] font-medium text-cyan-300 flex items-center justify-center gap-1"
              >
                <FilePlus2 className="w-3 h-3" />
                Load .vst3 / .aax / .dll
              </button>
              <input
                ref={pluginFileRef}
                type="file"
                accept=".vst3,.aaxplugin,.aax,.dll,.vst,.component"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLoadLocalPluginFile(file);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}

        {/* Insert Slots List + - Empty - Dropdown Slot */}
        <div className="flex-1 overflow-y-auto console-scroll p-1 space-y-[3px] bg-[#0a0d14]/70">
          {channel.inserts.map((plugin) => {
            const badge = FORMAT_BADGE[plugin.format ?? 'VST3'];
            return (
              <div
                key={plugin.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPlugin(channel.id, plugin);
                }}
                className={`group h-[21px] px-1 rounded-[2px] flex items-center justify-between gap-1 cursor-pointer border transition-all ${
                  plugin.enabled
                    ? 'bg-[#1a2232] border-cyan-500/30 hover:border-cyan-400/70 text-slate-100'
                    : 'bg-[#121620] border-white/5 hover:border-white/15 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-1 min-w-0">
                  <button
                    type="button"
                    title={plugin.enabled ? 'Bypass Plugin' : 'Enable Plugin'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate((c) => ({
                        ...c,
                        inserts: c.inserts.map((ins) =>
                          ins.id === plugin.id ? { ...ins, enabled: !ins.enabled } : ins
                        ),
                      }));
                    }}
                    className={`shrink-0 transition-colors ${
                      plugin.enabled
                        ? 'text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.7)]'
                        : 'text-slate-600 hover:text-slate-400'
                    }`}
                  >
                    <Power className="w-2.5 h-2.5" />
                  </button>
                  <span className="text-[9.5px] truncate leading-none">{plugin.name}</span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <span
                    className={`px-0.5 rounded-[2px] text-[7.5px] font-bold border leading-[11px] group-hover:hidden ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                  <button
                    type="button"
                    title="Remove Insert"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate((c) => ({
                        ...c,
                        inserts: c.inserts.filter((ins) => ins.id !== plugin.id),
                      }));
                    }}
                    className="hidden group-hover:block text-slate-500 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* "- Empty -" Insert Slot Dropdown (per Channel 3 Reference) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowInsertMenu((v) => !v);
              setShowInputMenu(false);
              setShowSendMenu(false);
            }}
            className="w-full h-[21px] px-1.5 rounded-[3px] bg-[#191f2a] hover:bg-[#232b3a] border border-white/15 hover:border-cyan-400/50 flex items-center justify-between text-[9.5px] text-slate-300 transition-colors"
          >
            <span className="truncate mx-auto">- Empty -</span>
            <ChevronDown className="w-2.5 h-2.5 text-slate-400 shrink-0" />
          </button>
        </div>
      </div>

      {/* Section 3: Sends Rack */}
      {!isMaster && !isListen ? (
        <div className="relative flex flex-col h-[106px] border-b border-[#1c2331]">
          <div className="h-[22px] px-1.5 flex items-center justify-between bg-[#131823] border-b border-[#1c2331] shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Toggle All Sends"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate((c) => ({
                    ...c,
                    sends: c.sends.map((s) => ({ ...s, enabled: !allSendsEnabled })),
                  }));
                }}
                className={`p-0.5 rounded transition-colors ${
                  allSendsEnabled ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Power className="w-3 h-3" />
              </button>
              <span className="text-[11px] font-medium text-slate-300">Sends</span>
            </div>
            <button
              type="button"
              title="Add FX Bus Send"
              onClick={(e) => {
                e.stopPropagation();
                setShowSendMenu((v) => !v);
                setShowInsertMenu(false);
              }}
              className="p-0.5 rounded text-slate-400 hover:text-cyan-300 hover:bg-white/5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {showSendMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-[22px] left-1 right-1 z-30 bg-[#0b0f18] border border-amber-500/40 rounded shadow-xl max-h-40 overflow-y-auto console-scroll p-1"
            >
              <div className="text-[9px] font-semibold text-amber-400 px-1.5 py-0.5">Send to FX</div>
              {availableSendTargets
                .filter((b) => b.id !== channel.id)
                .map((bus) => (
                  <button
                    key={bus.id}
                    type="button"
                    onClick={() => addSendBus(bus)}
                    className="w-full text-left px-1.5 py-1 text-[10px] text-slate-200 hover:bg-amber-500/20 hover:text-amber-200 rounded truncate block"
                  >
                    {bus.name}
                  </button>
                ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto console-scroll p-1 space-y-1 bg-[#0a0d14]/70">
            {channel.sends.map((send) => {
              const sendNorm = Math.max(0, Math.min(1, (send.levelDb + 60) / 66));
              return (
                <div
                  key={send.id}
                  onClick={(e) => e.stopPropagation()}
                  className={`px-1 py-1 rounded-[2px] border transition-colors ${
                    send.enabled
                      ? 'bg-[#192130] border-cyan-500/30'
                      : 'bg-[#121620] border-white/5 opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdate((c) => ({
                            ...c,
                            sends: c.sends.map((s) =>
                              s.id === send.id ? { ...s, enabled: !s.enabled } : s
                            ),
                          }))
                        }
                        className={`shrink-0 ${
                          send.enabled
                            ? 'text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.7)]'
                            : 'text-slate-600'
                        }`}
                      >
                        <Power className="w-2.5 h-2.5" />
                      </button>
                      <span className="text-[9.5px] font-medium text-slate-200 truncate">
                        {send.targetName}
                      </span>
                    </div>
                    <span className="text-[8.5px] font-mono-tabular text-slate-400">
                      {send.levelDb > 0 ? `+${send.levelDb}` : send.levelDb}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-60}
                    max={6}
                    step={1}
                    value={send.levelDb}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      onUpdate((c) => ({
                        ...c,
                        sends: c.sends.map((s) =>
                          s.id === send.id ? { ...s, levelDb: val } : s
                        ),
                      }));
                    }}
                    className="w-full h-1 bg-[#080a0f] rounded-full appearance-none cursor-pointer accent-cyan-400"
                    style={{
                      background: `linear-gradient(to right, #00e5ff ${sendNorm * 100}%, #111622 ${sendNorm * 100}%)`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="h-[106px] border-b border-[#1c2331] bg-[#0a0d14]/40 flex flex-col items-center justify-center px-2 text-center">
          <span className="text-[9.5px] font-medium text-slate-500">
            {isMaster ? 'Stereo Master Out' : 'Cue Monitor Bus'}
          </span>
          <span className="text-[9px] font-mono-tabular text-cyan-400/70 mt-1">Out 1-2</span>
        </div>
      )}

      {/* Section 4: Pan Slider OR Dual -∞ Readout */}
      {isMaster || isListen ? (
        <div className="px-1.5 py-2 border-b border-[#1c2331] grid grid-cols-2 gap-1">
          <div className="h-5 bg-[#080a10] border border-white/10 rounded-[2px] flex items-center justify-center text-[10px] font-mono-tabular text-cyan-300">
            {meter.peakDb <= -59 ? '-∞' : meter.peakDb.toFixed(1)}
          </div>
          <div className="h-5 bg-[#080a10] border border-white/10 rounded-[2px] flex items-center justify-center text-[10px] font-mono-tabular text-cyan-300">
            {meter.peakDb <= -59 ? '-∞' : meter.peakDb.toFixed(1)}
          </div>
        </div>
      ) : (
        <div className="px-1.5 pt-2 pb-1 border-b border-[#1c2331]">
          <div
            ref={panTrackRef}
            onPointerDown={(e) => {
              e.stopPropagation();
              panDragging.current = true;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              updatePanFromClientX(e.clientX);
            }}
            onPointerMove={(e) => {
              if (panDragging.current) updatePanFromClientX(e.clientX);
            }}
            onPointerUp={(e) => {
              panDragging.current = false;
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                // ignore
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onUpdate((c) => ({ ...c, pan: 0 }));
            }}
            title="Pan (Double-click to center)"
            className="relative h-2.5 bg-[#07090e] border border-white/10 rounded-[2px] cursor-ew-resize overflow-hidden"
          >
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
            <div
              className="absolute top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-full"
              style={{
                left: `${((channel.pan + 100) / 200) * 100}%`,
                backgroundColor: channel.neonAccent,
                boxShadow: `0 0 6px ${channel.neonAccent}`,
              }}
            />
          </div>
          <div className="text-center text-[10px] font-mono-tabular text-slate-300 mt-1">
            {formatPan(channel.pan)}
          </div>
        </div>
      )}

      {/* Section 5: Mute / Solo / Arm / Monitor */}
      <div className="px-1.5 py-1.5 space-y-1 border-b border-[#1c2331]">
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdate((c) => ({ ...c, mute: !c.mute }));
            }}
            className={`h-[20px] rounded-[2px] text-[10.5px] font-bold border transition-all ${
              channel.mute
                ? 'bg-rose-600 text-white border-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.65)]'
                : 'bg-[#1b212e] text-slate-300 border-white/10 hover:bg-[#232b3c]'
            }`}
          >
            M
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdate((c) => ({ ...c, solo: !c.solo }));
            }}
            className={`h-[20px] rounded-[2px] text-[10.5px] font-bold border transition-all ${
              channel.solo
                ? 'bg-amber-400 text-slate-950 border-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.7)]'
                : 'bg-[#1b212e] text-slate-300 border-white/10 hover:bg-[#232b3c]'
            }`}
          >
            S
          </button>
        </div>

        {isAudio && (
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              title="Record Arm"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate((c) => ({ ...c, recordArm: !c.recordArm }));
              }}
              className={`h-[19px] rounded-[2px] flex items-center justify-center border transition-all ${
                channel.recordArm
                  ? 'bg-rose-500/20 border-rose-500/70 shadow-[0_0_8px_rgba(244,63,94,0.45)]'
                  : 'bg-[#151a25] border-white/10 hover:bg-[#1d2433]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  channel.recordArm ? 'bg-rose-500 shadow-[0_0_6px_#ff3b5c]' : 'bg-slate-500'
                }`}
              />
            </button>
            <button
              type="button"
              title="Input Monitor (Live Mic / ASIO In)"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMic(channel.id);
              }}
              className={`h-[19px] rounded-[2px] flex items-center justify-center border transition-all ${
                channel.monitor
                  ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400/70 shadow-[0_0_8px_rgba(34,211,238,0.45)]'
                  : 'bg-[#151a25] text-slate-400 border-white/10 hover:text-slate-200'
              }`}
            >
              <Volume2 className="w-3 h-3" />
            </button>
          </div>
        )}

        {isFx && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdate((c) => ({ ...c, stereoMode: !c.stereoMode }));
            }}
            className={`w-full h-[19px] rounded-[2px] text-[10px] font-medium border transition-all ${
              channel.stereoMode
                ? 'bg-[#162235] text-sky-300 border-sky-500/40'
                : 'bg-[#151a25] text-slate-400 border-white/10'
            }`}
          >
            {channel.stereoMode ? 'Stereo' : 'Mono'}
          </button>
        )}

        {(isMaster || isListen) && (
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate((c) => ({ ...c, stereoMode: !c.stereoMode }));
              }}
              className="h-[19px] rounded-[2px] bg-[#162235] border border-cyan-500/30 text-[9.5px] text-cyan-300 font-medium flex items-center justify-center"
            >
              {channel.stereoMode ? 'Stereo' : 'Mono'}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate((c) => ({ ...c, faderDb: c.faderDb === -20 ? 0 : -20 }));
              }}
              className="h-[19px] rounded-[2px] bg-[#151a25] border border-white/10 text-[9.5px] text-slate-300 hover:text-white flex items-center justify-center"
            >
              Dim
            </button>
          </div>
        )}
      </div>

      {/* Section 6: dB Value + Meter + Neon Fader */}
      <div className="flex-1 flex flex-col justify-between px-1.5 pt-1.5 pb-1 min-h-0">
        <div className="text-center text-[11.5px] font-mono-tabular font-semibold text-slate-100 tracking-tight">
          {channel.faderDb <= -59.5
            ? '-∞'
            : channel.faderDb > 0
            ? `+${channel.faderDb.toFixed(1)}`
            : channel.faderDb.toFixed(1)}
        </div>

        <div className="flex items-center justify-between gap-1 my-auto">
          <PeakMeter
            left={meter.left}
            right={meter.right}
            clipped={meter.clipped}
            neonColor={channel.neonAccent}
            onResetClip={onResetClip}
          />
          <NeonFader
            valueDb={channel.faderDb}
            neonColor={channel.neonAccent}
            isFx={isFx || isMaster || isListen}
            onChange={(db) => onUpdate((c) => ({ ...c, faderDb: db }))}
          />
        </div>

        {/* Input Source & Load File row for Audio Channels */}
        {isAudio && (
          <div className="flex items-center justify-between gap-1 pt-0.5">
            <button
              type="button"
              title="Cycle Input: Empty / Stem / Live Mic"
              onClick={(e) => {
                e.stopPropagation();
                cycleInputSource();
              }}
              className="flex-1 h-[17px] px-1 rounded-[2px] bg-[#131824] border border-white/10 hover:border-cyan-400/50 text-[9px] text-slate-300 flex items-center justify-center gap-1 truncate"
            >
              {channel.inputSource === 'mic' ? (
                <>
                  <Mic className="w-2.5 h-2.5 text-rose-400 shrink-0" />
                  <span className="truncate">In {channel.inputChannelIndex}</span>
                </>
              ) : channel.inputSource === 'app' ? (
                <span className="truncate text-amber-300">{channel.inputLabel ?? 'App'}</span>
              ) : channel.inputSource === 'bus' ? (
                <span className="truncate text-violet-300">{channel.inputLabel ?? 'Bus'}</span>
              ) : channel.inputSource === 'file' ? (
                <>
                  <AudioWaveform className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                  <span className="truncate">{channel.audioFileName ?? 'Audio'}</span>
                </>
              ) : channel.inputSource === 'demo' ? (
                <>
                  <Radio className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
                  <span>Stem</span>
                </>
              ) : (
                <span className="text-slate-500">Empty</span>
              )}
            </button>
            <button
              type="button"
              title="Load Audio File (.wav/.mp3)"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="h-[17px] w-[18px] rounded-[2px] bg-[#131824] border border-white/10 hover:border-cyan-400/50 text-slate-400 hover:text-cyan-300 flex items-center justify-center shrink-0"
            >
              <FolderOpen className="w-2.5 h-2.5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onLoadFile(channel.id, file);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {/* Automation Mode */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            cycleAutomation();
          }}
          className="w-full h-[18px] mt-1 rounded-[2px] bg-[#121620] border border-white/10 hover:border-cyan-500/40 text-[9.5px] font-medium text-slate-300 flex items-center justify-center"
        >
          Auto:{' '}
          <span
            className={`ml-1 ${
              channel.automationMode === 'Off'
                ? 'text-slate-400'
                : channel.automationMode === 'Write'
                ? 'text-rose-400'
                : 'text-emerald-400'
            }`}
          >
            {channel.automationMode}
          </span>
        </button>
      </div>

      {/* Section 7: Channel Index & Waveform/FX */}
      <div className="h-[22px] px-2 flex items-center justify-between border-t border-[#1c2331] bg-[#0b0e15] text-[10.5px] font-mono-tabular text-slate-300 shrink-0">
        <span>{isMaster || isListen ? '' : channel.index}</span>
        {isAudio && <AudioWaveform className="w-3.5 h-3.5 text-cyan-400/80" />}
        {isFx && <span className="text-[10px] font-sans font-bold text-amber-400">FX</span>}
      </div>

      {/* Section 8: Bottom Color Nameplate */}
      <div
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraftName(channel.name);
          setEditingName(true);
        }}
        title="Double-click to name or rename channel"
        className="h-[22px] px-1 flex items-center justify-center shrink-0 cursor-text"
        style={{
          backgroundColor: channel.stripColor,
          boxShadow: `0 -1px 10px ${channel.neonAccent}44`,
        }}
      >
        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditingName(false);
            }}
            placeholder={`CH ${channel.index}`}
            className="w-full bg-black/40 text-white text-[10px] font-bold text-center outline-none rounded px-1"
          />
        ) : (
          <span className="text-[10.5px] font-bold tracking-wide text-slate-950 truncate">
            {channel.name}
          </span>
        )}
      </div>
    </div>
  );
};
