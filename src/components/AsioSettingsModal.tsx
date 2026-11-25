import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  RefreshCw,
  Server,
  X,
} from 'lucide-react';
import { audioEngine } from '../audio/AudioEngine';
import { matchHardwareDeviceForChannelLabel } from '../utils/audioDeviceMatch';
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
    outputDeviceId: string,
    bufferSize?: 32 | 64 | 128 | 256 | 512 | 1024
  ) => Promise<void>;
  onApplyInputDevice?: (inputDeviceId: string, activeInputLabels: string[]) => Promise<void>;
  onDevicesScanned?: (devices: AudioDeviceInfo[]) => void;
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
    name: 'Maono ASIO',
    kind: 'asio',
    deviceType: 'ASIO',
    driverMode: 'asio-native-bridge',
  },
  {
    name: 'ASIO4ALL v2',
    kind: 'asio',
    deviceType: 'ASIO',
    driverMode: 'asio4all-router',
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
  onApplyInputDevice,
  onDevicesScanned,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showControlPanel, setShowControlPanel] = useState(false);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const [midiOutputs, setMidiOutputs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deviceFeedback, setDeviceFeedback] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const scanAllHardware = async (requestPerm = false) => {
    setScanning(true);
    try {
      const [audioList, midiList] = await Promise.all([
        audioEngine.enumerateHardwareDevices(requestPerm),
        audioEngine.enumerateMidiDevices(),
      ]);
      setDevices(audioList);
      onDevicesScanned?.(audioList);
      setMidiInputs(midiList.inputs);
      setMidiOutputs(midiList.outputs);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    void scanAllHardware(false);
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onDeviceChange = () => {
      void scanAllHardware(false);
    };
    md.addEventListener('devicechange', onDeviceChange);
    return () => {
      md.removeEventListener('devicechange', onDeviceChange);
    };
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
    const dedupeByIdAndLabel = (items: AudioDeviceInfo[]) => {
      const seenIds = new Set<string>();
      const out: { id: string; label: string }[] = [];
      items.forEach((d) => {
        if (seenIds.has(d.deviceId)) return;
        seenIds.add(d.deviceId);
        // Avoid duplicating "Default - ..." if an identical physical label is already present, unless it's 'default'
        const duplicateLabel = out.some((x) => x.label === d.label);
        if (!duplicateLabel) {
          out.push({ id: d.deviceId, label: d.label });
        }
      });
      return out;
    };

    const allUnique = dedupeByIdAndLabel(hwOfKind);

    if (driverName === 'Maono ASIO' || driverName === 'Maono') {
      const maonoOutDefs = [
        { fallbackId: 'default-maono-hp-1-2', label: 'Maono HP Out 1 + 2', pattern: /maono.*(hp|headphone|speaker|main)/i },
        { fallbackId: 'default-maono-vc-1-2', label: 'Maono VC Out 1 + 2', pattern: /maono.*(vc|virtual).*1/i },
        { fallbackId: 'default-maono-vc-3-4', label: 'Maono VC Out 3 + 4', pattern: /maono.*(vc|virtual).*3/i },
        { fallbackId: 'default-maono-loop-1-2', label: 'Maono Loopback 1 + 2', pattern: /maono.*loopback/i },
      ];
      const maonoInDefs = [
        { fallbackId: 'default-maono-mic-1-2', label: 'Maono MIC In 1 + 2', pattern: /maono.*(mic|prostudio)/i },
        { fallbackId: 'default-maono-vc-in-1-2', label: 'Maono VC In 1 + 2', pattern: /maono.*(vc|virtual).*1/i },
        { fallbackId: 'default-maono-vc-in-3-4', label: 'Maono VC In 3 + 4', pattern: /maono.*(vc|virtual).*3/i },
        { fallbackId: 'default-maono-loop-in-1-2', label: 'Maono Loopback 1 + 2', pattern: /maono.*loopback/i },
      ];
      const defs = kind === 'audiooutput' ? maonoOutDefs : maonoInDefs;
      const maonoHw = hwOfKind.filter((d) => /maono/i.test(d.label));
      const fallbackHw = maonoHw[0] ?? hwOfKind[0];

      return defs.map((def) => {
        const matchedHw =
          matchHardwareDeviceForChannelLabel(def.label, hwOfKind, kind) ??
          maonoHw.find((d) => def.pattern.test(d.label)) ??
          fallbackHw;
        return {
          id: matchedHw ? matchedHw.deviceId : def.fallbackId,
          label: def.label,
        };
      });
    }

    if (driverName === 'Yamaha Steinberg USB') {
      const brandMatched = dedupeByIdAndLabel(
        hwOfKind.filter((d) => /yamaha|steinberg/i.test(d.label))
      );
      if (brandMatched.length > 0) return brandMatched;
      return kind === 'audiooutput'
        ? [{ id: 'default-yamaha-out-1-2', label: 'Yamaha Steinberg USB Out 1 + 2' }]
        : [{ id: 'default-yamaha-in-1-2', label: 'Yamaha Steinberg USB In 1 + 2' }];
    }

    if (driverName === 'Windows Audio') {
      if (allUnique.length > 0) return allUnique;
      return kind === 'audiooutput'
        ? [{ id: 'default-win-out-1-2', label: 'Windows Audio Out 1 + 2' }]
        : [{ id: 'default-win-in-1-2', label: 'Windows Audio In 1 + 2' }];
    }

    // ASIO4ALL v2 wraps real hardware endpoints when detected, falling back to default endpoints if none enumerated yet
    if (allUnique.length > 0) return allUnique;
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
      config.activeDeviceName === 'Maono ASIO' ||
      config.activeDeviceName === 'Maono' ||
      config.activeDeviceName === 'ASIO4ALL v2'
        ? ['Maono ProStudio MIDI In']
        : [];
    return Array.from(new Set([...base, ...midiInputs]));
  }, [config.activeDeviceName, isNoDevice, midiInputs]);

  const validOutputLabels = useMemo(() => new Set(audioOutputs.map((o) => o.label)), [audioOutputs]);
  const validInputLabels = useMemo(() => new Set(audioInputs.map((i) => i.label)), [audioInputs]);

  const activeOutputs = useMemo(() => {
    if (isNoDevice || audioOutputs.length === 0) return [];
    if (config.activeOutputChannels === undefined) {
      return audioOutputs[0] ? [audioOutputs[0].label] : [];
    }
    if (config.activeOutputChannels.length === 0) {
      return [];
    }
    const matched = config.activeOutputChannels.filter((l) => validOutputLabels.has(l));
    if (matched.length > 0) return matched;
    const byId = audioOutputs.find((o) => o.id === config.outputDeviceId);
    return byId ? [byId.label] : audioOutputs[0] ? [audioOutputs[0].label] : [];
  }, [isNoDevice, config.activeOutputChannels, config.outputDeviceId, validOutputLabels, audioOutputs]);

  const activeInputs = useMemo(() => {
    if (isNoDevice || audioInputs.length === 0) return [];
    if (config.activeInputChannels === undefined) {
      return audioInputs[0] ? [audioInputs[0].label] : [];
    }
    if (config.activeInputChannels.length === 0) {
      return [];
    }
    const matched = config.activeInputChannels.filter((l) => validInputLabels.has(l));
    if (matched.length > 0) return matched;
    const byId = audioInputs.find((i) => i.id === config.inputDeviceId);
    return byId ? [byId.label] : audioInputs[0] ? [audioInputs[0].label] : [];
  }, [isNoDevice, config.activeInputChannels, config.inputDeviceId, validInputLabels, audioInputs]);

  // Keep persisted device IDs & channel labels aligned once real hardware devices finish enumerating
  useEffect(() => {
    if (isNoDevice) return;
    const patch: Partial<AsioDriverConfig> = {};
    if (
      audioOutputs.length > 0 &&
      config.activeOutputChannels &&
      config.activeOutputChannels.length > 0 &&
      !config.activeOutputChannels.some((l) => validOutputLabels.has(l))
    ) {
      const targetOut = audioOutputs.find((o) => o.id === config.outputDeviceId) ?? audioOutputs[0];
      const nextOutId = targetOut.id.startsWith('default-') ? 'default' : targetOut.id;
      patch.activeOutputChannels = [targetOut.label];
      patch.outputDeviceId = nextOutId;
      void audioEngine.setOutputDevice(nextOutId);
    }
    if (
      audioInputs.length > 0 &&
      config.activeInputChannels &&
      config.activeInputChannels.length > 0 &&
      !config.activeInputChannels.some((l) => validInputLabels.has(l))
    ) {
      const targetIn = audioInputs.find((i) => i.id === config.inputDeviceId) ?? audioInputs[0];
      const nextInId = targetIn.id.startsWith('default-') ? 'default' : targetIn.id;
      patch.activeInputChannels = [targetIn.label];
      patch.inputDeviceId = nextInId;
    }
    if (Object.keys(patch).length > 0) {
      onUpdateConfig(patch);
    }
  }, [
    isNoDevice,
    audioOutputs,
    audioInputs,
    validOutputLabels,
    validInputLabels,
    config.activeOutputChannels,
    config.activeInputChannels,
    config.outputDeviceId,
    config.inputDeviceId,
  ]);

  const activeMidiIn = config.activeMidiInputs ?? [];
  const selectedMidiOut = config.midiOutput ?? '<< none >>';

  const inputLatencyMs = Number(((config.bufferSize / config.sampleRate) * 1000).toFixed(1));

  const normalizeHardwareId = (id: string) => (id.startsWith('default-') ? 'default' : id);

  const toggleOutputChannel = async (label: string, deviceId: string) => {
    const exists = activeOutputs.includes(label);
    const next = exists ? activeOutputs.filter((l) => l !== label) : [...activeOutputs, label];
    const clickedId = normalizeHardwareId(deviceId);

    let nextOutId = config.outputDeviceId;
    if (!exists) {
      nextOutId = clickedId;
    } else if (config.outputDeviceId === clickedId || !next.some((l) => audioOutputs.find((o) => o.label === l)?.id === config.outputDeviceId)) {
      const remaining = audioOutputs.find((o) => next.includes(o.label));
      nextOutId = remaining ? normalizeHardwareId(remaining.id) : 'default';
    }

    const enabled = next.length > 0 && !isNoDevice;
    audioEngine.setMasterOutputEnabled(enabled);

    onUpdateConfig({
      activeOutputChannels: next,
      outputDeviceId: nextOutId,
      outputChannels: next.length * 2,
    });

    if (enabled) {
      await audioEngine.ensureContext(config.sampleRate);
      await audioEngine.resumeIfNeeded(true);
      const ok = await audioEngine.setOutputDevice(nextOutId);
      const errMsg = audioEngine.getLastOutputError();
      if (!ok && errMsg) {
        setDeviceFeedback(errMsg);
      } else if (!ok && !audioEngine.isSinkIdSupported() && nextOutId !== 'default') {
        setDeviceFeedback('Browser ini memakai output default OS untuk Web Audio (setSinkId tidak didukung).');
      } else {
        setDeviceFeedback(null);
      }
    } else {
      setDeviceFeedback('Output audio dimatikan (tidak ada Active output channel dipilih).');
    }
  };

  const toggleInputChannel = async (label: string, deviceId: string) => {
    const exists = activeInputs.includes(label);
    const next = exists ? activeInputs.filter((l) => l !== label) : [...activeInputs, label];
    const clickedId = normalizeHardwareId(deviceId);

    let nextInId = config.inputDeviceId;
    if (!exists) {
      nextInId = clickedId;
    } else if (config.inputDeviceId === clickedId || !next.some((l) => audioInputs.find((i) => i.label === l)?.id === config.inputDeviceId)) {
      const remaining = audioInputs.find((i) => next.includes(i.label));
      nextInId = remaining ? normalizeHardwareId(remaining.id) : 'default';
    }

    onUpdateConfig({
      activeInputChannels: next,
      inputDeviceId: nextInId,
      inputChannels: next.length * 2,
    });

    await onApplyInputDevice?.(nextInId, next);
    if (next.length === 0) {
      setDeviceFeedback('Input audio dinonaktifkan (tidak ada Active input channel dipilih).');
    } else {
      setDeviceFeedback(null);
    }
  };

  const toggleMidiInput = (label: string) => {
    const exists = activeMidiIn.includes(label);
    const next = exists ? activeMidiIn.filter((l) => l !== label) : [...activeMidiIn, label];
    onUpdateConfig({ activeMidiInputs: next });
  };

  const applyDriverDefaults = async (
    driverName: string,
    nextType: AudioDeviceTypeLabel,
    nextMode: AsioDriverMode
  ) => {
    const nextOuts = getDriverScopedChannels(driverName, 'audiooutput', devices);
    const nextIns = getDriverScopedChannels(driverName, 'audioinput', devices);
    const firstOut = nextOuts[0];
    const firstIn = nextIns[0];
    const resolvedOutId = firstOut ? normalizeHardwareId(firstOut.id) : 'default';
    const resolvedInId = firstIn ? normalizeHardwareId(firstIn.id) : 'default';
    const isMaono = driverName === 'Maono ASIO' || driverName === 'Maono';
    const nextOutLabels = isMaono
      ? nextOuts.map((o) => o.label)
      : firstOut
      ? [firstOut.label]
      : [];
    const nextInLabels = isMaono
      ? nextIns.map((i) => i.label)
      : firstIn
      ? [firstIn.label]
      : [];

    onUpdateConfig({
      activeDeviceName: driverName,
      deviceType: nextType,
      driverMode: nextMode,
      activeOutputChannels: nextOutLabels,
      activeInputChannels: nextInLabels,
      outputDeviceId: resolvedOutId,
      inputDeviceId: resolvedInId,
      outputChannels: Math.max(0, nextOutLabels.length * 2),
      inputChannels: Math.max(0, nextInLabels.length * 2),
      bridgeStatusText:
        driverName === 'No Audio Device'
          ? 'No Audio Device Selected'
          : `${driverName} · ${config.bufferSize} smp Active`,
    });

    const isOutputActive = driverName !== 'No Audio Device' && nextOutLabels.length > 0;
    audioEngine.setMasterOutputEnabled(isOutputActive);
    if (isOutputActive) {
      await audioEngine.setOutputDevice(resolvedOutId);
    }
    await onApplyInputDevice?.(resolvedInId, driverName === 'No Audio Device' ? [] : nextInLabels);
    setDeviceFeedback(null);
  };

  const handleSelectDevice = (item: DevicePresetItem | { name: 'No Audio Device'; kind: 'none' }) => {
    setDropdownOpen(false);
    if (item.kind === 'none') {
      void applyDriverDefaults('No Audio Device', 'ASIO', 'webaudio-interactive');
      return;
    }
    void applyDriverDefaults(item.name, item.deviceType, item.driverMode);
  };

  const handleChangeSampleRate = async (sr: 44100 | 48000 | 88200 | 96000) => {
    onUpdateConfig({ sampleRate: sr });
    await onApplyAudioSettings(sr, config.outputDeviceId, config.bufferSize);
  };

  const handleChangeBufferSize = (buf: 32 | 64 | 128 | 256 | 512 | 1024) => {
    const inMs = Number(((buf / config.sampleRate) * 1000).toFixed(2));
    onUpdateConfig({
      bufferSize: buf,
      baseLatencyMs: inMs,
      outputLatencyMs: Number((inMs * 2).toFixed(2)),
      bridgeStatusText: `${config.activeDeviceName} · ${buf} smp Active`,
    });
    void onApplyAudioSettings(config.sampleRate, config.outputDeviceId, buf);
  };

  const handleTestAudio = async () => {
    setTesting(true);
    try {
      const played = await audioEngine.playTestTone(config.sampleRate, config.outputDeviceId);
      const errMsg = audioEngine.getLastOutputError();
      if (!played) {
        setDeviceFeedback('Aktifkan minimal satu Active output channel sebelum mengetes audio.');
      } else if (errMsg) {
        setDeviceFeedback(errMsg);
      } else {
        setDeviceFeedback(null);
      }
    } finally {
      window.setTimeout(() => setTesting(false), 580);
    }
  };

  const handleResetDevice = async () => {
    setResetting(true);
    try {
      await onApplyAudioSettings(config.sampleRate, config.outputDeviceId);
      await scanAllHardware(true);
      setDeviceFeedback(null);
    } finally {
      setResetting(false);
    }
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
    CORE_AUDIO_DEVICES.find(
      (d) =>
        d.name === config.activeDeviceName ||
        (config.activeDeviceName === 'Maono' && d.name === 'Maono ASIO')
    ) ?? null;
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

        {/* Header (Audio Device) + Latency Summary + Close */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#0c1018] border-b border-[#1d2536]">
          <span className="text-[12.5px] font-semibold text-[var(--theme-neon-soft)]">
            Audio Device
          </span>

          <div className="flex items-center gap-3">
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
        <div className="p-5 bg-[#090c13] rounded-b-lg text-[12px] max-h-[84vh] overflow-y-auto console-scroll">
          <div className="space-y-2.5">
              {/* Row 1: Audio device type */}
              <div className="grid grid-cols-[160px_1fr] items-center gap-3">
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
                          ? 'Maono ASIO'
                          : config.activeDeviceName
                        : 'Windows Audio';
                      void applyDriverDefaults(nextDriverName, chosen, nextMode);
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

              {/* Row 2: Device + Test */}
              <div className="grid grid-cols-[160px_1fr] items-center gap-3">
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
                    className={`h-[30px] px-4 rounded border text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${
                      testing
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                        : 'bg-[#121826] hover:bg-[#1a2234] border-[#273349] hover:border-[var(--theme-neon)] text-[var(--theme-neon-soft)]'
                    }`}
                  >
                    {testing ? 'Playing...' : 'Test'}
                  </button>
                </div>
              </div>

              {/* Row 3: Active output channels */}
              <div className="grid grid-cols-[160px_1fr] items-start gap-3">
                <label className="text-right text-slate-300 font-medium pt-2">
                  Active output channels:
                </label>
                <div className="min-h-[108px] max-h-[124px] overflow-y-auto rounded bg-[#0c1018] border border-[#222c40] p-1.5 space-y-0.5 console-scroll">
                  {audioOutputs.length === 0 ? (
                    <div className="px-2 py-3 text-[11px] text-slate-500 italic">
                      No output channels ({config.activeDeviceName})
                    </div>
                  ) : (
                    audioOutputs.map((out) => {
                      const checked = activeOutputs.includes(out.label);
                      return (
                        <button
                          key={`${out.id}-${out.label}`}
                          type="button"
                          onClick={() => void toggleOutputChannel(out.label, out.id)}
                          className="w-full flex items-center gap-2.5 px-2 py-1 text-left rounded hover:bg-white/[0.04] transition-colors"
                        >
                          <span
                            className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 transition-all ${
                              checked
                                ? 'border-[var(--theme-neon)] text-slate-950 shadow-[0_0_6px_rgba(var(--theme-neon-rgb),0.4)]'
                                : 'bg-[#121826] border-[#2e3a52] text-transparent'
                            }`}
                            style={checked ? { backgroundColor: 'var(--theme-neon)' } : undefined}
                          >
                            <Check className="w-3 h-3 stroke-[3]" />
                          </span>
                          <span className={`text-[12px] font-medium truncate ${checked ? 'text-slate-100' : 'text-slate-400'}`}>
                            {out.label}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Row 4: Active input channels */}
              <div className="grid grid-cols-[160px_1fr] items-start gap-3">
                <label className="text-right text-slate-300 font-medium pt-2">
                  Active input channels:
                </label>
                <div className="min-h-[108px] max-h-[124px] overflow-y-auto rounded bg-[#0c1018] border border-[#222c40] p-1.5 space-y-0.5 console-scroll">
                  {audioInputs.length === 0 ? (
                    <div className="px-2 py-3 text-[11px] text-slate-500 italic">
                      No input channels ({config.activeDeviceName})
                    </div>
                  ) : (
                    audioInputs.map((inp) => {
                      const checked = activeInputs.includes(inp.label);
                      return (
                        <button
                          key={`${inp.id}-${inp.label}`}
                          type="button"
                          onClick={() => void toggleInputChannel(inp.label, inp.id)}
                          className="w-full flex items-center gap-2.5 px-2 py-1 text-left rounded hover:bg-white/[0.04] transition-colors"
                        >
                          <span
                            className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 transition-all ${
                              checked
                                ? 'border-[var(--theme-neon)] text-slate-950 shadow-[0_0_6px_rgba(var(--theme-neon-rgb),0.4)]'
                                : 'bg-[#121826] border-[#2e3a52] text-transparent'
                            }`}
                            style={checked ? { backgroundColor: 'var(--theme-neon)' } : undefined}
                          >
                            <Check className="w-3 h-3 stroke-[3]" />
                          </span>
                          <span className={`text-[12px] font-medium truncate ${checked ? 'text-slate-100' : 'text-slate-400'}`}>
                            {inp.label}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {deviceFeedback && (
                <div className="grid grid-cols-[160px_1fr] gap-3">
                  <span />
                  <div className="rounded bg-amber-500/10 border border-amber-400/35 px-2.5 py-1.5 text-[11px] text-amber-200">
                    {deviceFeedback}
                  </div>
                </div>
              )}

              {/* Row 5: Sample rate */}
              <div className="grid grid-cols-[160px_1fr] items-center gap-3 pt-1">
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

              {/* Row 6: Audio buffer size */}
              <div className="grid grid-cols-[160px_1fr] items-center gap-3">
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

              {/* Row 7: Control Panel & Reset Device */}
              <div className="grid grid-cols-[160px_1fr] items-center gap-3 pt-0.5">
                <span />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowControlPanel((v) => !v)}
                    className={`h-[30px] px-4 rounded border text-[12px] font-medium flex items-center justify-center gap-1.5 whitespace-nowrap transition-all ${
                      showControlPanel
                        ? 'bg-[rgba(var(--theme-neon-rgb),0.18)] border-[var(--theme-neon)] text-[var(--theme-neon-soft)]'
                        : 'bg-[#121826] hover:bg-[#1a2234] border-[#273349] hover:border-[rgba(var(--theme-neon-rgb),0.55)] text-slate-200'
                    }`}
                  >
                    Control Panel
                  </button>
                  <button
                    type="button"
                    onClick={handleResetDevice}
                    disabled={resetting}
                    className="h-[30px] px-4 rounded bg-[#121826] hover:bg-[#1a2234] border border-[#273349] hover:border-[rgba(var(--theme-neon-rgb),0.55)] text-[12px] font-medium text-slate-200 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    {resetting ? 'Resetting...' : 'Reset Device'}
                  </button>
                </div>
              </div>

              {showControlPanel && (
                <div className="grid grid-cols-[160px_1fr] items-start gap-3 pt-0.5">
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
                        onClick={() => void scanAllHardware(true)}
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

              {/* Row 8: Active MIDI inputs */}
              <div className="grid grid-cols-[160px_1fr] items-start gap-3 pt-1">
                <label className="text-right text-slate-300 font-medium pt-2">
                  Active MIDI inputs:
                </label>
                <div className="min-h-[68px] max-h-[88px] overflow-y-auto rounded bg-[#0c1018] border border-[#222c40] p-1.5 space-y-0.5 console-scroll">
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
                          className="w-full flex items-center gap-2.5 px-2 py-1 text-left rounded hover:bg-white/[0.04] transition-colors"
                        >
                          <span
                            className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 transition-all ${
                              checked
                                ? 'border-[var(--theme-neon)] text-slate-950 shadow-[0_0_6px_rgba(var(--theme-neon-rgb),0.4)]'
                                : 'bg-[#121826] border-[#2e3a52] text-transparent'
                            }`}
                            style={checked ? { backgroundColor: 'var(--theme-neon)' } : undefined}
                          >
                            <Check className="w-3 h-3 stroke-[3]" />
                          </span>
                          <span
                            className={`text-[12px] font-medium truncate ${
                              checked ? 'text-slate-100' : 'text-slate-400'
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

              {/* Row 9: MIDI Output */}
              <div className="grid grid-cols-[160px_1fr] items-center gap-3">
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
            </div>
        </div>
      </div>
    </div>
  );
};
