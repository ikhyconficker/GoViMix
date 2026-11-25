import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  Headphones,
  Mic,
  Music2,
  RefreshCw,
  Server,
  Sliders,
  Volume2,
  X,
} from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import {
  AsioDriverConfig,
  AsioDriverMode,
  AudioDeviceInfo,
  AudioDeviceTypeLabel,
} from '../types/mixer';

interface AsioSettingsModalProps {
  config: AsioDriverConfig;
  onClose: () => void;
  onUpdateConfig: (next: Partial<AsioDriverConfig>) => void;
  onApplyAudioSettings: (
    sampleRate: 44100 | 48000 | 88200 | 96000,
    outputDeviceId: string
  ) => Promise<void>;
}

interface DevicePresetItem {
  name: string;
  kind: 'asio' | 'windows' | 'none';
  deviceType: AudioDeviceTypeLabel;
  driverMode: AsioDriverMode;
}

const DEVICE_TYPES: { label: AudioDeviceTypeLabel; mode: AsioDriverMode }[] = [
  { label: 'ASIO', mode: 'asio4all-router' },
  { label: 'Windows Audio', mode: 'webaudio-interactive' },
  { label: 'Windows Audio (Exclusive Mode)', mode: 'asio-native-bridge' },
  { label: 'DirectSound', mode: 'webaudio-interactive' },
];

const CORE_AUDIO_DEVICES: DevicePresetItem[] = [
  {
    name: 'ASIO4ALL v2',
    kind: 'asio',
    deviceType: 'ASIO',
    driverMode: 'asio4all-router',
  },
  {
    name: 'Maono',
    kind: 'asio',
    deviceType: 'ASIO',
    driverMode: 'asio-native-bridge',
  },
  {
    name: 'Yamaha Steinberg USB',
    kind: 'asio',
    deviceType: 'ASIO',
    driverMode: 'asio-native-bridge',
  },
  {
    name: 'Windows Audio',
    kind: 'windows',
    deviceType: 'Windows Audio',
    driverMode: 'webaudio-interactive',
  },
];

const SAMPLE_RATES: (44100 | 48000 | 88200 | 96000)[] = [44100, 48000, 88200, 96000];
const BUFFER_SIZES: (32 | 64 | 128 | 256 | 512 | 1024)[] = [32, 64, 128, 256, 512, 1024];

const AudioInterfaceIcon: React.FC<{ kind: 'asio' | 'windows' | 'none'; className?: string }> = ({
  kind,
  className = 'w-8 h-4',
}) => (
  <svg viewBox="0 0 44 20" fill="none" className={className} aria-hidden="true">
    {kind === 'asio' && (
      <text x="14" y="5.5" fill="currentColor" fontSize="5" fontWeight="700" letterSpacing="0.8">
        ASIO
      </text>
    )}
    <rect x="2" y="7" width="40" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <line x1="6" y1="10.5" x2="12" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
    <line x1="6" y1="13.5" x2="12" y2="13.5" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="17" cy="12" r="1.4" fill="currentColor" />
    <circle cx="22.5" cy="12" r="1.4" fill="currentColor" />
    <circle cx="28" cy="12" r="1.4" fill="currentColor" />
    <circle cx="34.5" cy="12" r="2.1" stroke="currentColor" strokeWidth="1.2" />
    {kind === 'none' && (
      <>
        <circle cx="22" cy="10" r="8" fill="#0d111a" fillOpacity="0.85" stroke="currentColor" strokeWidth="1.6" />
        <line x1="16.5" y1="4.5" x2="27.5" y2="15.5" stroke="currentColor" strokeWidth="1.6" />
      </>
    )}
  </svg>
);

export const AsioSettingsModal: React.FC<AsioSettingsModalProps> = ({
  config,
  onClose,
  onUpdateConfig,
  onApplyAudioSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'device' | 'processing'>('device');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showControlPanel, setShowControlPanel] = useState(false);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const [midiOutputs, setMidiOutputs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const scanAllHardware = async (requestPerm = false) => {
    setScanning(true);
    const [audioList, midiList] = await Promise.all([
      audioEngine.enumerateHardwareDevices(requestPerm),
      audioEngine.enumerateMidiDevices(),
    ]);
    setDevices(audioList);
    setMidiInputs(midiList.inputs);
    setMidiOutputs(midiList.outputs);
    setScanning(false);
  };

  useEffect(() => {
    scanAllHardware(false);
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [dropdownOpen]);

  const deviceType: AudioDeviceTypeLabel = config.deviceType ?? 'ASIO';
  const isNoDevice = config.activeDeviceName === 'No Audio Device';

  const getDriverScopedChannels = (
    driverName: string,
    kind: 'audioinput' | 'audiooutput',
    allHw: AudioDeviceInfo[]
  ): { id: string; label: string }[] => {
    if (driverName === 'No Audio Device') return [];

    const hwOfKind = allHw.filter((d) => d.kind === kind);
    const dedupeByLabel = (items: AudioDeviceInfo[]) => {
      const out: { id: string; label: string }[] = [];
      items.forEach((d) => {
        if (!out.some((x) => x.label === d.label)) {
          out.push({ id: d.deviceId, label: d.label });
        }
      });
      return out;
    };

    if (driverName === 'Maono') {
      const matched = dedupeByLabel(
        hwOfKind.filter((d) => /maono/i.test(d.label))
      );
      if (matched.length > 0) return matched;
      return kind === 'audiooutput'
        ? [
            { id: 'default-maono-out-1-2', label: 'Maono VC Out 1/2 (Maono ProStudio 2×2)' },
            { id: 'default-maono-main-1-2', label: 'Maono Main Out 1/2' },
          ]
        : [
            { id: 'default-maono-in-1-2', label: 'Maono Mic In 1/2 (Maono ProStudio 2×2)' },
            { id: 'default-maono-vc-in-1-2', label: 'Maono VC In 1/2' },
          ];
    }

    if (driverName === 'Yamaha Steinberg USB') {
      const matched = dedupeByLabel(
        hwOfKind.filter((d) => /yamaha|steinberg/i.test(d.label))
      );
      if (matched.length > 0) return matched;
      return kind === 'audiooutput'
        ? [{ id: 'default-yamaha-out-1-2', label: 'Yamaha Steinberg USB Out 1 + 2' }]
        : [{ id: 'default-yamaha-in-1-2', label: 'Yamaha Steinberg USB In 1 + 2' }];
    }

    if (driverName === 'Windows Audio') {
      const matched = dedupeByLabel(hwOfKind);
      if (matched.length > 0) return matched;
      return kind === 'audiooutput'
        ? [{ id: 'default-win-out-1-2', label: 'Windows Audio Out 1 + 2' }]
        : [{ id: 'default-win-in-1-2', label: 'Windows Audio In 1 + 2' }];
    }

    // ASIO4ALL v2: strictly ASIO4ALL v2 driver endpoints (not unrelated USB cameras / other brand drivers)
    return kind === 'audiooutput'
      ? [{ id: 'default-asio4all-out-1-2', label: '2nd output with HAP 1 + 2' }]
      : [{ id: 'default-asio4all-in-1-2', label: 'HD Audio Mic input 1 + 2' }];
  };

  const audioInputs = useMemo(
    () => getDriverScopedChannels(config.activeDeviceName, 'audioinput', devices),
    [config.activeDeviceName, devices]
  );

  const audioOutputs = useMemo(
    () => getDriverScopedChannels(config.activeDeviceName, 'audiooutput', devices),
    [config.activeDeviceName, devices]
  );

  const midiInputList = useMemo(() => {
    if (isNoDevice) return [];
    const base =
      config.activeDeviceName === 'Maono' || config.activeDeviceName === 'ASIO4ALL v2'
        ? ['Maono ProStudio MIDI In']
        : [];
    return Array.from(new Set([...base, ...midiInputs]));
  }, [config.activeDeviceName, isNoDevice, midiInputs]);

  const validOutputLabels = useMemo(() => new Set(audioOutputs.map((o) => o.label)), [audioOutputs]);
  const validInputLabels = useMemo(() => new Set(audioInputs.map((i) => i.label)), [audioInputs]);

  const activeOutputs = useMemo(() => {
    const raw = (config.activeOutputChannels ?? []).filter((l) => validOutputLabels.has(l));
    if (raw.length > 0) return raw;
    return audioOutputs[0] ? [audioOutputs[0].label] : [];
  }, [config.activeOutputChannels, validOutputLabels, audioOutputs]);

  const activeInputs = useMemo(() => {
    const raw = (config.activeInputChannels ?? []).filter((l) => validInputLabels.has(l));
    if (raw.length > 0) return raw;
    return audioInputs[0] ? [audioInputs[0].label] : [];
  }, [config.activeInputChannels, validInputLabels, audioInputs]);

  const activeMidiIn = config.activeMidiInputs ?? [];
  const selectedMidiOut = config.midiOutput ?? '<< none >>';

  const inputLatencyMs = Number(((config.bufferSize / config.sampleRate) * 1000).toFixed(1));
  const outputLatencyMs = Number((((config.bufferSize * 2) / config.sampleRate) * 1000).toFixed(1));

  const toggleOutputChannel = (label: string, deviceId: string) => {
    const exists = activeOutputs.includes(label);
    const next = exists ? activeOutputs.filter((l) => l !== label) : [...activeOutputs, label];
    const resolvedOutId = deviceId.startsWith('default-') ? 'default' : deviceId;
    onUpdateConfig({
      activeOutputChannels: next,
      outputDeviceId: resolvedOutId,
      outputChannels: Math.max(2, next.length * 2),
    });
    audioEngine.setOutputDevice(resolvedOutId);
  };

  const toggleInputChannel = (label: string, deviceId: string) => {
    const exists = activeInputs.includes(label);
    const next = exists ? activeInputs.filter((l) => l !== label) : [...activeInputs, label];
    const resolvedInId = deviceId.startsWith('default-') ? 'default' : deviceId;
    onUpdateConfig({
      activeInputChannels: next,
      inputDeviceId: resolvedInId,
      inputChannels: Math.max(2, next.length * 2),
    });
  };

  const toggleMidiInput = (label: string) => {
    const exists = activeMidiIn.includes(label);
    const next = exists ? activeMidiIn.filter((l) => l !== label) : [...activeMidiIn, label];
    onUpdateConfig({ activeMidiInputs: next });
  };

  const applyDriverDefaults = (
    driverName: string,
    nextType: AudioDeviceTypeLabel,
    nextMode: AsioDriverMode
  ) => {
    const nextOuts = getDriverScopedChannels(driverName, 'audiooutput', devices);
    const nextIns = getDriverScopedChannels(driverName, 'audioinput', devices);
    const firstOut = nextOuts[0];
    const firstIn = nextIns[0];
    const resolvedOutId = firstOut
      ? firstOut.id.startsWith('default-')
        ? 'default'
        : firstOut.id
      : 'default';
    const resolvedInId = firstIn
      ? firstIn.id.startsWith('default-')
        ? 'default'
        : firstIn.id
      : 'default';

    onUpdateConfig({
      activeDeviceName: driverName,
      deviceType: nextType,
      driverMode: nextMode,
      activeOutputChannels: firstOut ? [firstOut.label] : [],
      activeInputChannels: firstIn ? [firstIn.label] : [],
      outputDeviceId: resolvedOutId,
      inputDeviceId: resolvedInId,
      outputChannels: firstOut ? 2 : 0,
      inputChannels: firstIn ? 2 : 0,
      bridgeStatusText:
        driverName === 'No Audio Device'
          ? 'No Audio Device Selected'
          : `${driverName} · ${config.bufferSize} smp Active`,
    });

    if (driverName !== 'No Audio Device') {
      audioEngine.setOutputDevice(resolvedOutId);
    }
  };

  const handleSelectDevice = (item: DevicePresetItem | { name: 'No Audio Device'; kind: 'none' }) => {
    setDropdownOpen(false);
    if (item.kind === 'none') {
      applyDriverDefaults('No Audio Device', 'ASIO', 'webaudio-interactive');
      return;
    }
    applyDriverDefaults(item.name, item.deviceType, item.driverMode);
  };

  const handleChangeSampleRate = async (sr: 44100 | 48000 | 88200 | 96000) => {
    onUpdateConfig({ sampleRate: sr });
    await onApplyAudioSettings(sr, config.outputDeviceId);
  };

  const handleChangeBufferSize = (buf: 32 | 64 | 128 | 256 | 512 | 1024) => {
    const inMs = Number(((buf / config.sampleRate) * 1000).toFixed(2));
    onUpdateConfig({
      bufferSize: buf,
      baseLatencyMs: inMs,
      outputLatencyMs: Number((inMs * 2).toFixed(2)),
      bridgeStatusText: `${config.activeDeviceName} · ${buf} smp Active`,
    });
  };

  const handleTestAudio = async () => {
    setTesting(true);
    try {
      await audioEngine.playTestTone(config.sampleRate, config.outputDeviceId);
    } finally {
      window.setTimeout(() => setTesting(false), 580);
    }
  };

  const handleResetDevice = async () => {
    setResetting(true);
    await onApplyAudioSettings(config.sampleRate, config.outputDeviceId);
    await scanAllHardware(true);
    setResetting(false);
  };

  const handleConnectBridge = () => {
    onUpdateConfig({ bridgeStatusText: 'Probing local ASIO Bridge...' });
    audioEngine.connectAsioBridge(config.bridgeUrl, (connected, statusText, deviceName) => {
      onUpdateConfig({
        bridgeConnected: connected,
        bridgeStatusText: statusText,
        activeDeviceName: deviceName ?? config.activeDeviceName,
        driverMode: connected ? 'asio-native-bridge' : config.driverMode,
      });
    });
  };

  const formatBufferOption = (buf: number) => {
    const ms = ((buf / config.sampleRate) * 1000).toFixed(1);
    return `${buf} samples (${ms} ms)`;
  };

  const selectedPreset =
    CORE_AUDIO_DEVICES.find((d) => d.name === config.activeDeviceName) ?? null;
  const activeIconKind: 'asio' | 'windows' | 'none' = isNoDevice
    ? 'none'
    : selectedPreset?.kind ?? 'asio';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] rounded-lg border border-[rgba(var(--theme-neon-rgb),0.45)] shadow-[0_28px_90px_rgba(0,0,0,0.95),0_0_32px_rgba(var(--theme-neon-rgb),0.1)] overflow-visible text-slate-200"
        style={{ backgroundColor: 'var(--theme-bg-panel)' }}
      >
        {/* Top Neon Accent Bar */}
        <div
          className="h-[4px] w-full rounded-t-[7px] shrink-0"
          style={{
            backgroundColor: 'var(--theme-neon)',
            boxShadow: '0 0 12px rgba(var(--theme-neon-rgb), 0.7)',
          }}
        />

        {/* Top Tabs Header (Audio Device | Processing) + Latency Summary + Close */}
        <div className="flex items-center justify-between px-3 pt-2 bg-[#0c1018] border-b border-[#1d2536]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('device')}
              className={`px-3.5 py-2 text-[12px] font-semibold rounded-t transition-all border-b-2 ${
                activeTab === 'device'
                  ? 'bg-[#121826] text-[var(--theme-neon-soft)] border-[var(--theme-neon)]'
                  : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-white/5'
              }`}
            >
              Audio Device
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('processing')}
              className={`px-3.5 py-2 text-[12px] font-semibold rounded-t transition-all border-b-2 ${
                activeTab === 'processing'
                  ? 'bg-[#121826] text-[var(--theme-neon-soft)] border-[var(--theme-neon)]'
                  : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-white/5'
              }`}
            >
              Processing
            </button>
          </div>

          <div className="flex items-center gap-3 mb-1">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono-tabular text-slate-400">
              <span>{deviceType}</span>
              <span aria-hidden="true">·</span>
              <span className="text-[var(--theme-neon-soft)]">{(config.sampleRate / 1000).toFixed(1)} kHz</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">{isNoDevice ? '—' : `${inputLatencyMs} ms`}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Audio Setup"
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-2.5 bg-[#090c13] rounded-b-lg text-[12px] max-h-[84vh] overflow-y-auto console-scroll">
          {activeTab === 'device' ? (
            <>
              {/* Card 1: Audio Device Type + Device Selector + Test */}
              <div className="rounded-md bg-[#0e131e] border border-[#1d2536] p-3 space-y-2.5">
                {/* Audio device type */}
                <div className="grid grid-cols-[155px_1fr] items-center gap-3">
                  <label className="text-right text-slate-300 font-medium">
                    Audio device type:
                  </label>
                  <div className="relative">
                    <select
                      value={deviceType}
                      onChange={(e) => {
                        const chosen = e.target.value as AudioDeviceTypeLabel;
                        const mapped = DEVICE_TYPES.find((d) => d.label === chosen);
                        const nextMode = mapped?.mode ?? 'asio4all-router';
                        const isAsioType = chosen === 'ASIO';
                        const nextDriverName = isAsioType
                          ? config.activeDeviceName === 'Windows Audio' || config.activeDeviceName === 'No Audio Device'
                            ? 'ASIO4ALL v2'
                            : config.activeDeviceName
                          : 'Windows Audio';
                        applyDriverDefaults(nextDriverName, chosen, nextMode);
                      }}
                      className="w-full h-[30px] pl-2.5 pr-7 rounded bg-[#121826] hover:bg-[#172033] border border-[#273349] focus:border-[var(--theme-neon)] text-[12px] text-slate-100 appearance-none outline-none"
                    >
                      {DEVICE_TYPES.map((dt) => (
                        <option key={dt.label} value={dt.label} className="bg-[#0d111a] text-slate-100">
                          {dt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-neon)] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* Device + Test */}
                <div className="grid grid-cols-[155px_1fr] items-center gap-3">
                  <label className="text-right text-slate-300 font-medium">
                    Device:
                  </label>
                  <div className="flex items-center gap-2 min-w-0">
                    <div ref={dropdownRef} className="relative flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => setDropdownOpen((v) => !v)}
                        className={`w-full h-[30px] px-2.5 rounded bg-[#121826] hover:bg-[#172033] border flex items-center justify-between gap-2 transition-colors ${
                          dropdownOpen
                            ? 'border-[var(--theme-neon)] shadow-[0_0_10px_rgba(var(--theme-neon-rgb),0.22)]'
                            : 'border-[#273349] hover:border-[rgba(var(--theme-neon-rgb),0.55)]'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <AudioInterfaceIcon
                            kind={activeIconKind}
                            className="w-7 h-3.5 text-[var(--theme-neon-soft)] shrink-0"
                          />
                          <span className="truncate text-slate-100 font-medium">
                            {config.activeDeviceName}
                          </span>
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-neon)] shrink-0" />
                      </button>

                      {dropdownOpen && (
                        <div className="absolute left-0 right-0 top-[34px] z-50 rounded-md bg-[#0f1522] border border-[rgba(var(--theme-neon-rgb),0.45)] shadow-[0_18px_48px_rgba(0,0,0,0.92)] py-1.5 overflow-hidden">
                          {CORE_AUDIO_DEVICES.map((item) => {
                            const isSelected = config.activeDeviceName === item.name;
                            return (
                              <button
                                key={item.name}
                                type="button"
                                onClick={() => handleSelectDevice(item)}
                                className={`w-full px-3 py-1.5 flex items-center gap-3 text-left transition-colors ${
                                  isSelected
                                    ? 'bg-[rgba(var(--theme-neon-rgb),0.18)] text-[var(--theme-neon-soft)]'
                                    : 'text-slate-200 hover:bg-white/5'
                                }`}
                              >
                                <AudioInterfaceIcon
                                  kind={item.kind}
                                  className={`w-8 h-4 shrink-0 ${
                                    isSelected ? 'text-[var(--theme-neon)]' : 'text-slate-300'
                                  }`}
                                />
                                <span className="flex-1 truncate font-medium">{item.name}</span>
                                {isSelected && (
                                  <Check className="w-3.5 h-3.5 text-[var(--theme-neon)] shrink-0" />
                                )}
                              </button>
                            );
                          })}

                          <div className="my-1 border-t border-[#1e273a]" />

                          <button
                            type="button"
                            onClick={() => handleSelectDevice({ name: 'No Audio Device', kind: 'none' })}
                            className={`w-full px-3 py-1.5 flex items-center gap-3 text-left transition-colors ${
                              isNoDevice
                                ? 'bg-[rgba(var(--theme-neon-rgb),0.18)] text-[var(--theme-neon-soft)]'
                                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                            }`}
                          >
                            <AudioInterfaceIcon
                              kind="none"
                              className={`w-8 h-4 shrink-0 ${
                                isNoDevice ? 'text-[var(--theme-neon)]' : 'text-slate-400'
                              }`}
                            />
                            <span className="flex-1 truncate font-medium">No Audio Device</span>
                            {isNoDevice && (
                              <Check className="w-3.5 h-3.5 text-[var(--theme-neon)] shrink-0" />
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleTestAudio}
                      className={`h-[30px] px-3.5 rounded border text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${
                        testing
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                          : 'bg-[#121826] hover:bg-[#1a2234] border-[rgba(var(--theme-neon-rgb),0.4)] hover:border-[var(--theme-neon)] text-[var(--theme-neon-soft)]'
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      {testing ? 'Playing...' : 'Test'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 2: Active Output & Input Channels */}
              <div className="rounded-md bg-[#0e131e] border border-[#1d2536] p-3 space-y-2.5">
                {/* Active output channels */}
                <div className="grid grid-cols-[155px_1fr] items-start gap-3">
                  <label className="text-right text-slate-300 font-medium pt-1.5 flex items-center justify-end gap-1.5">
                    <Headphones className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
                    <span>Active output channels:</span>
                  </label>
                  <div className="min-h-[58px] max-h-[82px] overflow-y-auto rounded bg-[#070a10] border border-[#1d2536] p-1.5 space-y-1 console-scroll">
                    {audioOutputs.length === 0 ? (
                      <div className="px-2 py-3 text-[11px] text-slate-500 italic">
                        No output channels ({config.activeDeviceName})
                      </div>
                    ) : (
                      audioOutputs.map((out) => {
                        const checked = activeOutputs.includes(out.label);
                        return (
                          <button
                            key={out.id}
                            type="button"
                            onClick={() => toggleOutputChannel(out.label, out.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1 text-left rounded border transition-all ${
                              checked
                                ? 'bg-[rgba(var(--theme-neon-rgb),0.09)] border-[rgba(var(--theme-neon-rgb),0.35)] text-white'
                                : 'bg-transparent border-transparent hover:bg-white/5 text-slate-400'
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 transition-all ${
                                checked
                                  ? 'border-[var(--theme-neon)] text-slate-950 shadow-[0_0_8px_rgba(var(--theme-neon-rgb),0.45)]'
                                  : 'bg-[#121826] border-[#2e3a52] text-transparent'
                              }`}
                              style={checked ? { backgroundColor: 'var(--theme-neon)' } : undefined}
                            >
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                            <span className="text-[12px] font-medium truncate">{out.label}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Active input channels */}
                <div className="grid grid-cols-[155px_1fr] items-start gap-3">
                  <label className="text-right text-slate-300 font-medium pt-1.5 flex items-center justify-end gap-1.5">
                    <Mic className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
                    <span>Active input channels:</span>
                  </label>
                  <div className="min-h-[58px] max-h-[82px] overflow-y-auto rounded bg-[#070a10] border border-[#1d2536] p-1.5 space-y-1 console-scroll">
                    {audioInputs.length === 0 ? (
                      <div className="px-2 py-3 text-[11px] text-slate-500 italic">
                        No input channels ({config.activeDeviceName})
                      </div>
                    ) : (
                      audioInputs.map((inp) => {
                        const checked = activeInputs.includes(inp.label);
                        return (
                          <button
                            key={inp.id}
                            type="button"
                            onClick={() => toggleInputChannel(inp.label, inp.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1 text-left rounded border transition-all ${
                              checked
                                ? 'bg-[rgba(var(--theme-neon-rgb),0.09)] border-[rgba(var(--theme-neon-rgb),0.35)] text-white'
                                : 'bg-transparent border-transparent hover:bg-white/5 text-slate-400'
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 transition-all ${
                                checked
                                  ? 'border-[var(--theme-neon)] text-slate-950 shadow-[0_0_8px_rgba(var(--theme-neon-rgb),0.45)]'
                                  : 'bg-[#121826] border-[#2e3a52] text-transparent'
                              }`}
                              style={checked ? { backgroundColor: 'var(--theme-neon)' } : undefined}
                            >
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                            <span className="text-[12px] font-medium truncate">{inp.label}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Card 3: Sample Rate, Audio Buffer Size, Latency, Control Panel & Reset Device */}
              <div className="rounded-md bg-[#0e131e] border border-[#1d2536] p-3 space-y-2">
                {/* Sample rate */}
                <div className="grid grid-cols-[155px_1fr] items-center gap-3">
                  <label className="text-right text-slate-300 font-medium">
                    Sample rate:
                  </label>
                  <div className="relative">
                    <select
                      value={config.sampleRate}
                      onChange={(e) =>
                        handleChangeSampleRate(
                          Number(e.target.value) as 44100 | 48000 | 88200 | 96000
                        )
                      }
                      className="w-full h-[30px] pl-2.5 pr-7 rounded bg-[#121826] hover:bg-[#172033] border border-[#273349] focus:border-[var(--theme-neon)] text-[12px] font-mono-tabular text-[var(--theme-neon-soft)] appearance-none outline-none"
                    >
                      {SAMPLE_RATES.map((sr) => (
                        <option key={sr} value={sr} className="bg-[#0d111a] text-slate-100">
                          {sr} Hz
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-neon)] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* Audio buffer size */}
                <div className="grid grid-cols-[155px_1fr] items-center gap-3">
                  <label className="text-right text-slate-300 font-medium">
                    Audio buffer size:
                  </label>
                  <div className="relative">
                    <select
                      value={config.bufferSize}
                      onChange={(e) =>
                        handleChangeBufferSize(
                          Number(e.target.value) as 32 | 64 | 128 | 256 | 512 | 1024
                        )
                      }
                      className="w-full h-[30px] pl-2.5 pr-7 rounded bg-[#121826] hover:bg-[#172033] border border-[#273349] focus:border-[var(--theme-neon)] text-[12px] font-mono-tabular text-slate-100 appearance-none outline-none"
                    >
                      {BUFFER_SIZES.map((buf) => (
                        <option key={buf} value={buf} className="bg-[#0d111a] text-slate-100">
                          {formatBufferOption(buf)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-neon)] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* Input / Output Latency Readout */}
                <div className="grid grid-cols-[155px_1fr] items-center gap-3">
                  <span className="text-right text-slate-400 text-[11.5px]">Latency (In / Out):</span>
                  <div className="flex items-center gap-3 font-mono-tabular text-[11.5px]">
                    <span className="text-[var(--theme-neon-soft)]">
                      In: {isNoDevice ? '—' : `${inputLatencyMs.toFixed(1)} ms`}
                    </span>
                    <span className="text-slate-600">/</span>
                    <span className="text-emerald-400">
                      Out: {isNoDevice ? '—' : `${outputLatencyMs.toFixed(1)} ms`}
                    </span>
                  </div>
                </div>

                {/* Control Panel & Reset Device */}
                <div className="grid grid-cols-[155px_1fr] items-center gap-3 pt-0.5">
                  <span />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowControlPanel((v) => !v)}
                      className={`h-[30px] px-3.5 rounded border text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all ${
                        showControlPanel
                          ? 'bg-[rgba(var(--theme-neon-rgb),0.18)] border-[var(--theme-neon)] text-[var(--theme-neon-soft)]'
                          : 'bg-[#121826] hover:bg-[#1a2234] border-[#273349] hover:border-[rgba(var(--theme-neon-rgb),0.55)] text-slate-200'
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
                      Control Panel
                    </button>
                    <button
                      type="button"
                      onClick={handleResetDevice}
                      disabled={resetting}
                      className="h-[30px] px-3.5 rounded bg-[#121826] hover:bg-[#1a2234] border border-[#273349] hover:border-[rgba(var(--theme-neon-rgb),0.55)] text-[12px] font-semibold text-slate-200 transition-colors flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-[var(--theme-neon)] ${resetting ? 'animate-spin' : ''}`} />
                      {resetting ? 'Resetting...' : 'Reset Device'}
                    </button>
                  </div>
                </div>

                {showControlPanel && (
                  <div className="grid grid-cols-[155px_1fr] items-start gap-3 pt-1">
                    <span className="text-right text-[11px] text-slate-400 pt-2">
                      ASIO Bridge:
                    </span>
                    <div className="rounded bg-[#090d16] border border-[rgba(var(--theme-neon-rgb),0.35)] p-2.5 space-y-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[var(--theme-neon-soft)] flex items-center gap-1.5">
                          <Server className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
                          {config.activeDeviceName} Bridge &amp; WDM Scan
                        </span>
                        <button
                          type="button"
                          onClick={() => scanAllHardware(true)}
                          className="px-2 py-1 rounded bg-[#141b2b] hover:bg-[#1c263b] border border-[#2b3750] text-slate-200 flex items-center gap-1"
                        >
                          <RefreshCw className={`w-3 h-3 text-[var(--theme-neon)] ${scanning ? 'animate-spin' : ''}`} />
                          {scanning ? 'Scanning...' : 'Scan I/O'}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={config.bridgeUrl}
                          onChange={(e) => onUpdateConfig({ bridgeUrl: e.target.value })}
                          className="flex-1 h-7 px-2 rounded bg-[#070a10] border border-[#232d42] focus:border-[var(--theme-neon)] font-mono-tabular text-slate-200 outline-none"
                          placeholder="ws://localhost:31337"
                        />
                        <button
                          type="button"
                          onClick={handleConnectBridge}
                          className="h-7 px-3 rounded bg-[rgba(var(--theme-neon-rgb),0.16)] hover:bg-[rgba(var(--theme-neon-rgb),0.26)] border border-[rgba(var(--theme-neon-rgb),0.5)] font-semibold text-[var(--theme-neon-soft)] whitespace-nowrap"
                        >
                          Connect
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[10.5px] text-slate-400">
                        <span className="flex items-center gap-1.5 truncate">
                          <Activity className="w-3 h-3 text-[var(--theme-neon)] shrink-0" />
                          <strong className={config.bridgeConnected ? 'text-emerald-400' : 'text-[var(--theme-neon-soft)]'}>
                            {config.bridgeStatusText}
                          </strong>
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Card 4: MIDI Routing & Background Release */}
              <div className="rounded-md bg-[#0e131e] border border-[#1d2536] p-3 space-y-2.5">
                {/* Active MIDI inputs */}
                <div className="grid grid-cols-[155px_1fr] items-start gap-3">
                  <label className="text-right text-slate-300 font-medium pt-1.5 flex items-center justify-end gap-1.5">
                    <Music2 className="w-3.5 h-3.5 text-[var(--theme-neon)]" />
                    <span>Active MIDI inputs:</span>
                  </label>
                  <div className="min-h-[54px] max-h-[78px] overflow-y-auto rounded bg-[#070a10] border border-[#1d2536] p-1.5 space-y-1 console-scroll">
                    {midiInputList.length === 0 ? (
                      <div className="px-2 py-2.5 text-[11px] text-slate-500 italic">
                        No MIDI inputs available for {config.activeDeviceName}
                      </div>
                    ) : (
                      midiInputList.map((midiName) => {
                        const checked = activeMidiIn.includes(midiName);
                        return (
                          <button
                            key={midiName}
                            type="button"
                            onClick={() => toggleMidiInput(midiName)}
                            className={`w-full flex items-center gap-2 px-2 py-1 text-left rounded border transition-all ${
                              checked
                                ? 'bg-[rgba(var(--theme-neon-rgb),0.09)] border-[rgba(var(--theme-neon-rgb),0.35)] text-white'
                                : 'bg-transparent border-transparent hover:bg-white/5 text-slate-400'
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 transition-all ${
                                checked
                                  ? 'border-[var(--theme-neon)] text-slate-950 shadow-[0_0_8px_rgba(var(--theme-neon-rgb),0.45)]'
                                  : 'bg-[#121826] border-[#2e3a52] text-transparent'
                              }`}
                              style={checked ? { backgroundColor: 'var(--theme-neon)' } : undefined}
                            >
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                            <span
                              className={`text-[12px] font-medium truncate ${
                                checked ? 'text-white' : 'text-slate-400'
                              }`}
                            >
                              {midiName}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* MIDI Output */}
                <div className="grid grid-cols-[155px_1fr] items-center gap-3">
                  <label className="text-right text-slate-300 font-medium">
                    MIDI Output:
                  </label>
                  <div className="relative">
                    <select
                      value={selectedMidiOut}
                      onChange={(e) => onUpdateConfig({ midiOutput: e.target.value })}
                      className="w-full h-[30px] pl-2.5 pr-7 rounded bg-[#121826] hover:bg-[#172033] border border-[#273349] focus:border-[var(--theme-neon)] text-[12px] text-slate-100 appearance-none outline-none"
                    >
                      <option value="<< none >>" className="bg-[#0d111a] text-slate-100">
                        &lt;&lt; none &gt;&gt;
                      </option>
                      {midiOutputs.map((outName) => (
                        <option key={outName} value={outName} className="bg-[#0d111a] text-slate-100">
                          {outName}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-neon)] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* Release audio device in background */}
                <div className="grid grid-cols-[155px_1fr] items-center gap-3 pt-1 border-t border-[#182030]">
                  <span />
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateConfig({ releaseInBackground: !config.releaseInBackground })
                    }
                    className="flex items-center gap-2.5 text-left group"
                  >
                    <span
                      className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 transition-all ${
                        config.releaseInBackground
                          ? 'border-[var(--theme-neon)] text-slate-950 shadow-[0_0_8px_rgba(var(--theme-neon-rgb),0.45)]'
                          : 'bg-[#121826] border-[#2e3a52] text-transparent group-hover:border-[rgba(var(--theme-neon-rgb),0.55)]'
                      }`}
                      style={
                        config.releaseInBackground
                          ? { backgroundColor: 'var(--theme-neon)' }
                          : undefined
                      }
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                    <span className="text-[12px] text-slate-300 group-hover:text-white transition-colors">
                      Release audio device in background
                    </span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Tab 2: Processing */
            <div className="rounded-md bg-[#0e131e] border border-[#1d2536] p-3.5 space-y-3">
              <div className="grid grid-cols-[145px_1fr] items-center gap-3">
                <label className="text-right text-slate-300 font-medium">
                  Process Precision:
                </label>
                <div className="relative max-w-[240px]">
                  <select
                    value={config.bitDepth}
                    onChange={(e) =>
                      onUpdateConfig({ bitDepth: Number(e.target.value) as 24 | 32 })
                    }
                    className="w-full h-[30px] pl-2.5 pr-7 rounded bg-[#121826] hover:bg-[#172033] border border-[#273349] focus:border-[var(--theme-neon)] text-[12px] text-slate-100 appearance-none outline-none"
                  >
                    <option value={24} className="bg-[#0d111a] text-slate-100">
                      Single (24-bit)
                    </option>
                    <option value={32} className="bg-[#0d111a] text-slate-100">
                      Double (32-bit float)
                    </option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-neon)] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div className="grid grid-cols-[145px_1fr] items-center gap-3">
                <label className="text-right text-slate-300 font-medium">
                  Primary Input:
                </label>
                <div className="relative">
                  <select
                    value={config.inputDeviceId}
                    onChange={(e) => onUpdateConfig({ inputDeviceId: e.target.value })}
                    className="w-full h-[30px] pl-2.5 pr-7 rounded bg-[#121826] hover:bg-[#172033] border border-[#273349] focus:border-[var(--theme-neon)] text-[12px] text-slate-100 appearance-none outline-none"
                  >
                    <option value="default" className="bg-[#0d111a] text-slate-100">
                      Default Audio Input
                    </option>
                    {audioInputs.map((inp) => (
                      <option key={inp.id} value={inp.id} className="bg-[#0d111a] text-slate-100">
                        {inp.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-neon)] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div className="grid grid-cols-[145px_1fr] items-center gap-3">
                <label className="text-right text-slate-300 font-medium">
                  Primary Output:
                </label>
                <div className="relative">
                  <select
                    value={config.outputDeviceId}
                    onChange={(e) => {
                      onUpdateConfig({ outputDeviceId: e.target.value });
                      audioEngine.setOutputDevice(e.target.value);
                    }}
                    className="w-full h-[30px] pl-2.5 pr-7 rounded bg-[#121826] hover:bg-[#172033] border border-[#273349] focus:border-[var(--theme-neon)] text-[12px] text-slate-100 appearance-none outline-none"
                  >
                    <option value="default" className="bg-[#0d111a] text-slate-100">
                      Default Audio Output
                    </option>
                    {audioOutputs.map((out) => (
                      <option key={out.id} value={out.id} className="bg-[#0d111a] text-slate-100">
                        {out.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-neon)] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div className="pt-2 border-t border-[#182030] flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => scanAllHardware(true)}
                  className="h-[30px] px-3 rounded bg-[#121826] hover:bg-[#1a2234] border border-[#273349] hover:border-[rgba(var(--theme-neon-rgb),0.5)] text-[11.5px] font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-[var(--theme-neon)] ${scanning ? 'animate-spin' : ''}`} />
                  {scanning ? 'Scanning...' : 'Scan Hardware I/O'}
                </button>

                <button
                  type="button"
                  onClick={handleTestAudio}
                  className={`h-[30px] px-3.5 rounded border text-[11.5px] font-semibold flex items-center gap-1.5 transition-all ${
                    testing
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                      : 'bg-[rgba(var(--theme-neon-rgb),0.14)] hover:bg-[rgba(var(--theme-neon-rgb),0.24)] border-[rgba(var(--theme-neon-rgb),0.45)] text-[var(--theme-neon-soft)]'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  {testing ? 'Playing...' : 'Test Audio'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
