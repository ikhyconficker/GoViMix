import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, RefreshCw, Server, X } from 'lucide-react';
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

const DEVICE_TYPES: { label: AudioDeviceTypeLabel; mode: AsioDriverMode }[] = [
  { label: 'ASIO', mode: 'asio4all-router' },
  { label: 'Windows Audio', mode: 'webaudio-interactive' },
  { label: 'Windows Audio (Exclusive Mode)', mode: 'asio-native-bridge' },
  { label: 'DirectSound', mode: 'webaudio-interactive' },
];

const BUILTIN_ASIO_DEVICES = [
  'ASIO4ALL v2',
  'FL Studio ASIO',
  'Focusrite USB ASIO',
  'Steinberg Built-in ASIO Driver',
  'Behringer UMC ASIO Driver',
];

const SAMPLE_RATES: (44100 | 48000 | 88200 | 96000)[] = [44100, 48000, 88200, 96000];
const BUFFER_SIZES: (32 | 64 | 128 | 256 | 512 | 1024)[] = [32, 64, 128, 256, 512, 1024];

export const AsioSettingsModal: React.FC<AsioSettingsModalProps> = ({
  config,
  onClose,
  onUpdateConfig,
  onApplyAudioSettings,
}) => {
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const [midiOutputs, setMidiOutputs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showControlPanel, setShowControlPanel] = useState(false);

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

  const deviceType: AudioDeviceTypeLabel = config.deviceType ?? 'ASIO';

  const audioInputs = useMemo(() => {
    const hw = devices.filter((d) => d.kind === 'audioinput');
    const list: { id: string; label: string }[] = [
      { id: 'default-in-1-2', label: 'HD Audio Mic input 1 + 2' },
    ];
    hw.forEach((d) => {
      if (!list.some((item) => item.label === d.label)) {
        list.push({ id: d.deviceId, label: d.label });
      }
    });
    return list;
  }, [devices]);

  const audioOutputs = useMemo(() => {
    const hw = devices.filter((d) => d.kind === 'audiooutput');
    const list: { id: string; label: string }[] = [
      { id: 'default-out-1-2', label: '2nd output with HAP 1 + 2' },
    ];
    hw.forEach((d) => {
      if (!list.some((item) => item.label === d.label)) {
        list.push({ id: d.deviceId, label: d.label });
      }
    });
    return list;
  }, [devices]);

  const availableDevices = useMemo(() => {
    const hwNames = devices
      .filter((d) => d.label && !d.label.startsWith('Audio Input') && !d.label.startsWith('Audio Output'))
      .map((d) => d.label);
    return Array.from(new Set([...BUILTIN_ASIO_DEVICES, ...hwNames]));
  }, [devices]);

  const midiInputList = useMemo(() => {
    const base = ['Maono ProStudio MIDI In'];
    return Array.from(new Set([...base, ...midiInputs]));
  }, [midiInputs]);

  const activeOutputs = config.activeOutputChannels ?? ['2nd output with HAP 1 + 2'];
  const activeInputs = config.activeInputChannels ?? ['HD Audio Mic input 1 + 2'];
  const activeMidiIn = config.activeMidiInputs ?? [];
  const selectedMidiOut = config.midiOutput ?? '<< none >>';

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

  const handleChangeSampleRate = async (sr: 44100 | 48000 | 88200 | 96000) => {
    onUpdateConfig({ sampleRate: sr });
    await onApplyAudioSettings(sr, config.outputDeviceId);
  };

  const handleChangeBufferSize = (buf: 32 | 64 | 128 | 256 | 512 | 1024) => {
    const ms = Number(((buf / config.sampleRate) * 1000).toFixed(2));
    onUpdateConfig({
      bufferSize: buf,
      baseLatencyMs: ms,
      outputLatencyMs: Number((ms * 2).toFixed(2)),
      bridgeStatusText: `Low Latency Priority · ${buf} smp Active`,
    });
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-4 select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[660px] rounded-lg bg-[#2a3036] border border-[#454d56] shadow-[0_28px_80px_rgba(0,0,0,0.92)] overflow-hidden text-[#e6eaef]"
      >
        {/* Subtle top bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#21262b] border-b border-[#3a4149]">
          <span className="text-[12px] font-medium text-[#cfd6de] tracking-wide">
            Audio &amp; MIDI Settings — {config.activeDeviceName}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#9aa4b0] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Main JUCE-style Form Body */}
        <div className="p-5 space-y-2.5 text-[12.5px]">
          {/* Audio device type */}
          <div className="grid grid-cols-[175px_1fr] items-center gap-3">
            <label className="text-right text-[#d5dce3] font-normal">
              Audio device type:
            </label>
            <div className="relative">
              <select
                value={deviceType}
                onChange={(e) => {
                  const chosen = e.target.value as AudioDeviceTypeLabel;
                  const mapped = DEVICE_TYPES.find((d) => d.label === chosen);
                  onUpdateConfig({
                    deviceType: chosen,
                    driverMode: mapped?.mode ?? 'asio4all-router',
                  });
                }}
                className="w-full h-[30px] pl-2.5 pr-7 rounded-[4px] bg-[#3e454d] border border-[#525b65] text-[12.5px] text-[#edf1f5] appearance-none outline-none focus:border-[#7b8794]"
              >
                {DEVICE_TYPES.map((dt) => (
                  <option key={dt.label} value={dt.label}>
                    {dt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#c7cfd8] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Device + Test */}
          <div className="grid grid-cols-[175px_1fr] items-center gap-3">
            <label className="text-right text-[#d5dce3] font-normal">
              Device:
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  value={config.activeDeviceName}
                  onChange={(e) => onUpdateConfig({ activeDeviceName: e.target.value })}
                  className="w-full h-[30px] pl-2.5 pr-7 rounded-[4px] bg-[#3e454d] border border-[#525b65] text-[12.5px] text-[#edf1f5] appearance-none outline-none focus:border-[#7b8794]"
                >
                  {availableDevices.map((dev) => (
                    <option key={dev} value={dev}>
                      {dev}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#c7cfd8] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <button
                type="button"
                onClick={handleTestAudio}
                className={`h-[30px] px-4 rounded-[4px] border text-[12px] font-medium transition-colors ${
                  testing
                    ? 'bg-emerald-600 border-emerald-400 text-white'
                    : 'bg-[#454d56] hover:bg-[#505964] border-[#5b6570] text-[#edf1f5]'
                }`}
              >
                {testing ? 'Playing...' : 'Test'}
              </button>
            </div>
          </div>

          {/* Active output channels */}
          <div className="grid grid-cols-[175px_1fr] items-start gap-3">
            <label className="text-right text-[#d5dce3] font-normal pt-1.5">
              Active output channels:
            </label>
            <div className="min-h-[68px] max-h-[88px] overflow-y-auto rounded-[3px] bg-[#24292e] border border-[#1a1e22] p-1.5 space-y-1 console-scroll">
              {audioOutputs.map((out) => {
                const checked = activeOutputs.includes(out.label);
                return (
                  <button
                    key={out.id}
                    type="button"
                    onClick={() => toggleOutputChannel(out.label, out.id)}
                    className="w-full flex items-center gap-2 px-1 py-0.5 text-left hover:bg-white/5 rounded-[3px] transition-colors"
                  >
                    <span
                      className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 ${
                        checked
                          ? 'bg-[#3d4650] border-[#8b96a3] text-white'
                          : 'bg-[#2a3036] border-[#616b76] text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[2.8]" />
                    </span>
                    <span className="text-[12.5px] text-[#e1e6eb] truncate">{out.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active input channels */}
          <div className="grid grid-cols-[175px_1fr] items-start gap-3">
            <label className="text-right text-[#d5dce3] font-normal pt-1.5">
              Active input channels:
            </label>
            <div className="min-h-[68px] max-h-[88px] overflow-y-auto rounded-[3px] bg-[#24292e] border border-[#1a1e22] p-1.5 space-y-1 console-scroll">
              {audioInputs.map((inp) => {
                const checked = activeInputs.includes(inp.label);
                return (
                  <button
                    key={inp.id}
                    type="button"
                    onClick={() => toggleInputChannel(inp.label, inp.id)}
                    className="w-full flex items-center gap-2 px-1 py-0.5 text-left hover:bg-white/5 rounded-[3px] transition-colors"
                  >
                    <span
                      className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 ${
                        checked
                          ? 'bg-[#3d4650] border-[#8b96a3] text-white'
                          : 'bg-[#2a3036] border-[#616b76] text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[2.8]" />
                    </span>
                    <span className="text-[12.5px] text-[#e1e6eb] truncate">{inp.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sample rate */}
          <div className="grid grid-cols-[175px_1fr] items-center gap-3">
            <label className="text-right text-[#d5dce3] font-normal">
              Sample rate:
            </label>
            <div className="relative">
              <select
                value={config.sampleRate}
                onChange={(e) =>
                  handleChangeSampleRate(Number(e.target.value) as 44100 | 48000 | 88200 | 96000)
                }
                className="w-full h-[30px] pl-2.5 pr-7 rounded-[4px] bg-[#3e454d] border border-[#525b65] text-[12.5px] text-[#edf1f5] appearance-none outline-none focus:border-[#7b8794]"
              >
                {SAMPLE_RATES.map((sr) => (
                  <option key={sr} value={sr}>
                    {sr} Hz
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#c7cfd8] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Audio buffer size */}
          <div className="grid grid-cols-[175px_1fr] items-center gap-3">
            <label className="text-right text-[#d5dce3] font-normal">
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
                className="w-full h-[30px] pl-2.5 pr-7 rounded-[4px] bg-[#3e454d] border border-[#525b65] text-[12.5px] text-[#edf1f5] appearance-none outline-none focus:border-[#7b8794]"
              >
                {BUFFER_SIZES.map((buf) => (
                  <option key={buf} value={buf}>
                    {formatBufferOption(buf)}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#c7cfd8] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Control Panel & Reset Device */}
          <div className="grid grid-cols-[175px_1fr] items-center gap-3 pt-0.5">
            <span />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowControlPanel((v) => !v)}
                className={`h-[30px] px-4 rounded-[4px] border text-[12px] font-medium transition-colors ${
                  showControlPanel
                    ? 'bg-[#545e69] border-[#788492] text-white'
                    : 'bg-[#454d56] hover:bg-[#505964] border-[#5b6570] text-[#edf1f5]'
                }`}
              >
                Control Panel
              </button>
              <button
                type="button"
                onClick={handleResetDevice}
                disabled={resetting}
                className="h-[30px] px-4 rounded-[4px] bg-[#454d56] hover:bg-[#505964] border border-[#5b6570] text-[12px] font-medium text-[#edf1f5] transition-colors flex items-center gap-1.5"
              >
                {resetting && <RefreshCw className="w-3 h-3 animate-spin" />}
                {resetting ? 'Resetting...' : 'Reset Device'}
              </button>
            </div>
          </div>

          {/* Expandable ASIO4ALL / Hardware Control Panel */}
          {showControlPanel && (
            <div className="grid grid-cols-[175px_1fr] items-start gap-3">
              <span className="text-right text-[11px] text-[#9ea8b3] pt-2">
                ASIO Control Panel:
              </span>
              <div className="rounded-[4px] bg-[#1e2328] border border-[#3a424b] p-3 space-y-2.5 text-[11.5px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5" />
                    ASIO Bridge &amp; Hardware WDM Scan
                  </span>
                  <button
                    type="button"
                    onClick={() => scanAllHardware(true)}
                    className="px-2.5 py-1 rounded bg-[#363e47] hover:bg-[#434d58] border border-[#545e6a] text-[11px] text-white flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${scanning ? 'animate-spin' : ''}`} />
                    {scanning ? 'Scanning...' : 'Scan Hardware I/O'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={config.bridgeUrl}
                    onChange={(e) => onUpdateConfig({ bridgeUrl: e.target.value })}
                    className="flex-1 h-7 px-2 rounded bg-[#14171a] border border-[#353c45] text-[11px] font-mono-tabular text-slate-200 outline-none"
                    placeholder="ws://localhost:31337"
                  />
                  <button
                    type="button"
                    onClick={handleConnectBridge}
                    className="h-7 px-3 rounded bg-cyan-600/30 hover:bg-cyan-600/45 border border-cyan-400/50 text-[11px] font-medium text-cyan-200"
                  >
                    Connect Bridge
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#9ea8b3]">
                  <span>
                    Status:{' '}
                    <strong className={config.bridgeConnected ? 'text-emerald-400' : 'text-amber-300'}>
                      {config.bridgeStatusText}
                    </strong>
                  </span>
                  <span className="font-mono-tabular text-cyan-300">
                    {config.sampleRate} Hz / {config.bufferSize} smp
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Active MIDI inputs */}
          <div className="grid grid-cols-[175px_1fr] items-start gap-3 pt-1">
            <label className="text-right text-[#d5dce3] font-normal pt-1.5">
              Active MIDI inputs:
            </label>
            <div className="min-h-[68px] max-h-[88px] overflow-y-auto rounded-[3px] bg-[#24292e] border border-[#1a1e22] p-1.5 space-y-1 console-scroll">
              {midiInputList.map((midiName) => {
                const checked = activeMidiIn.includes(midiName);
                return (
                  <button
                    key={midiName}
                    type="button"
                    onClick={() => toggleMidiInput(midiName)}
                    className="w-full flex items-center gap-2 px-1 py-0.5 text-left hover:bg-white/5 rounded-[3px] transition-colors"
                  >
                    <span
                      className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 ${
                        checked
                          ? 'bg-[#3d4650] border-[#8b96a3] text-white'
                          : 'bg-[#2a3036] border-[#616b76] text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[2.8]" />
                    </span>
                    <span
                      className={`text-[12.5px] truncate ${
                        checked ? 'text-[#e1e6eb]' : 'text-[#8c96a1]'
                      }`}
                    >
                      {midiName}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* MIDI Output */}
          <div className="grid grid-cols-[175px_1fr] items-center gap-3 pb-1">
            <label className="text-right text-[#d5dce3] font-normal">
              MIDI Output:
            </label>
            <div className="relative">
              <select
                value={selectedMidiOut}
                onChange={(e) => onUpdateConfig({ midiOutput: e.target.value })}
                className="w-full h-[30px] pl-2.5 pr-7 rounded-[4px] bg-[#3e454d] border border-[#525b65] text-[12.5px] text-[#edf1f5] appearance-none outline-none focus:border-[#7b8794]"
              >
                <option value="<< none >>">&lt;&lt; none &gt;&gt;</option>
                {midiOutputs.map((outName) => (
                  <option key={outName} value={outName}>
                    {outName}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#c7cfd8] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
