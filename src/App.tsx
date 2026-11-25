import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { audioEngine } from './audio/AudioEngine';
import { AsioSettingsModal } from './components/AsioSettingsModal';
import { ChannelStrip } from './components/ChannelStrip';
import { DesktopExeModal } from './components/DesktopExeModal';
import { PluginModal } from './components/PluginModal';
import { CpuMonitorMetrics, TopTransportBar } from './components/TopTransportBar';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import {
  INITIAL_ASIO_CONFIG,
  INITIAL_CHANNELS,
  INITIAL_TRANSPORT,
} from './data/defaultSession';
import {
  AsioDriverConfig,
  AudioDeviceInfo,
  ChannelState,
  InputSourceType,
  InsertPlugin,
  MeterReading,
  TransportState,
} from './types/mixer';

const STORAGE_KEY = 'govimix-session-v9';

const EXTRA_COLORS = [
  { strip: '#8b5cf6', neon: '#a78bfa', tint: 'rgba(91, 33, 182, 0.25)' },
  { strip: '#ec4899', neon: '#f472b6', tint: 'rgba(157, 23, 77, 0.25)' },
  { strip: '#14b8a6', neon: '#2dd4bf', tint: 'rgba(17, 94, 89, 0.25)' },
];

export default function App() {
  const [channels, setChannels] = useState<ChannelState[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.channels) && parsed.channels.length > 0) {
          return parsed.channels;
        }
      }
    } catch {
      // ignore storage errors
    }
    return INITIAL_CHANNELS;
  });

  const [asioConfig, setAsioConfig] = useState<AsioDriverConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.asioConfig) return { ...INITIAL_ASIO_CONFIG, ...parsed.asioConfig, bridgeConnected: false };
      }
    } catch {
      // ignore
    }
    return INITIAL_ASIO_CONFIG;
  });

  const [transport, setTransport] = useState<TransportState>(INITIAL_TRANSPORT);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('ch-3');
  const [showAsioModal, setShowAsioModal] = useState(false);
  const [showDesktopModal, setShowDesktopModal] = useState(false);
  const [activePluginRef, setActivePluginRef] = useState<{ channelId: string; pluginId: string } | null>(null);
  const { isInstallable, isInstalled, isElectron, install: installDesktopApp } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [meters, setMeters] = useState<Record<string, MeterReading>>({});
  const [recordedAudioUrl] = useState<string | null>(null);
  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [cpuMetrics, setCpuMetrics] = useState<CpuMonitorMetrics>({
    cpuPercent: 5,
    activePlugins: 12,
    activeStreams: 3,
    roundTripMs: 4.0,
  });

  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const asioConfigRef = useRef(asioConfig);
  asioConfigRef.current = asioConfig;
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastCpuSampleRef = useRef<number>(0);

  useEffect(() => {
    audioEngine.enumerateHardwareDevices(false).then((list) => {
      setInputDevices(list.filter((d) => d.kind === 'audioinput'));
    });
  }, []);

  // Persist mixer & ASIO preferences
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ channels, asioConfig })
      );
    } catch {
      // ignore quota errors
    }
  }, [channels, asioConfig]);

  // Sync audio parameters whenever channels change
  useEffect(() => {
    if (audioEngine.isInitialized()) {
      audioEngine.rebuildGraph(channels);
    }
  }, [channels]);

  useEffect(() => {
    audioEngine.updateTransportSnapshot(transport);
  }, [transport]);

  // Real-time Metering & Playhead Animation Loop
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const frameDeltaMs =
        lastFrameTimeRef.current !== null ? now - lastFrameTimeRef.current : 16.67;

      if (lastFrameTimeRef.current !== null && transportRef.current.isPlaying) {
        const dt = Math.min(0.1, frameDeltaMs / 1000);
        setTransport((prev) => {
          let nextTime = prev.currentTimeSec + dt;
          if (prev.isLooping && nextTime >= prev.loopEndSec) {
            nextTime = prev.loopStartSec;
          }
          return { ...prev, currentTimeSec: nextTime };
        });
      }
      lastFrameTimeRef.current = now;

      if (audioEngine.isInitialized()) {
        setMeters(audioEngine.sampleMeters(channelsRef.current));
      }

      if (now - lastCpuSampleRef.current >= 350) {
        lastCpuSampleRef.current = now;
        setCpuMetrics(
          audioEngine.getDspCpuMetrics(
            channelsRef.current,
            asioConfigRef.current,
            transportRef.current.isPlaying,
            frameDeltaMs
          )
        );
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handlePlayPause = useCallback(async () => {
    if (transportRef.current.isPlaying) {
      audioEngine.stopPlayback();
      setTransport((t) => ({ ...t, isPlaying: false }));
    } else {
      const nextTransport = { ...transportRef.current, isPlaying: true };
      setTransport(nextTransport);
      await audioEngine.startPlayback(nextTransport, channelsRef.current, asioConfig);
    }
  }, [asioConfig]);

  // Keyboard shortcut (Space = Play/Pause)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePlayPause]);

  const updateChannel = (channelId: string, updater: (prev: ChannelState) => ChannelState) => {
    setChannels((prev) => prev.map((c) => (c.id === channelId ? updater(c) : c)));
  };

  const handleUpdatePlugin = (
    channelId: string,
    pluginId: string,
    updater: (p: InsertPlugin) => InsertPlugin
  ) => {
    updateChannel(channelId, (ch) => ({
      ...ch,
      inserts: ch.inserts.map((ins) => (ins.id === pluginId ? updater(ins) : ins)),
    }));
  };

  const handleToggleMic = async (channelId: string) => {
    const target = channels.find((c) => c.id === channelId);
    if (!target) return;
    const nextMonitor = !target.monitor;
    await audioEngine.ensureContext(asioConfig.sampleRate);
    audioEngine.rebuildGraph(channels);
    if (target.inputSource === 'mic') {
      await audioEngine.enableLiveMicInput(
        channelId,
        target.inputDeviceId ?? asioConfig.inputDeviceId,
        nextMonitor
      );
    }
    updateChannel(channelId, (c) => ({ ...c, monitor: nextMonitor }));
  };

  const handleSelectInput = async (
    channelId: string,
    source: InputSourceType,
    channelIndex: number,
    label: string,
    deviceId?: string
  ) => {
    await audioEngine.ensureContext(asioConfig.sampleRate);
    audioEngine.rebuildGraph(channelsRef.current);

    if (source === 'mic') {
      const targetDev = deviceId ?? asioConfig.inputDeviceId;
      await audioEngine.enableLiveMicInput(channelId, targetDev, true);
      // Refresh device list if user granted permission
      const devs = await audioEngine.enumerateHardwareDevices(false);
      setInputDevices(devs.filter((d) => d.kind === 'audioinput'));
    } else if (source === 'app') {
      if (deviceId === 'app-capture') {
        await audioEngine.enableApplicationAudioInput(channelId);
      }
    } else {
      await audioEngine.enableLiveMicInput(channelId, undefined, false);
    }

    updateChannel(channelId, (c) => ({
      ...c,
      inputSource: source,
      inputChannelIndex: channelIndex,
      inputLabel: label,
      inputDeviceId: deviceId,
      monitor: source === 'mic' || source === 'app' ? true : c.monitor,
    }));
  };

  const handleLoadFile = async (channelId: string, file: File) => {
    const res = await audioEngine.loadAudioFileForChannel(channelId, file);
    if (!res) return;
    updateChannel(channelId, (c) => ({
      ...c,
      inputSource: 'file',
      inputLabel: file.name,
      audioFileName: file.name,
    }));
  };

  const handleAddAudioTrack = () => {
    const trackChannels = channels.filter((c) => c.type === 'audio' || c.type === 'fx');
    const nextIdx = trackChannels.length + 1;
    const palette = EXTRA_COLORS[(nextIdx - 1) % EXTRA_COLORS.length];
    const newTrack: ChannelState = {
      id: `ch-custom-${Date.now()}`,
      index: nextIdx,
      name: '',
      type: 'audio',
      stripColor: palette.strip,
      neonAccent: palette.neon,
      tintBg: palette.tint,
      inputGainDb: 0.0,
      polarityLeft: false,
      polarityRight: false,
      pan: 0,
      mute: false,
      solo: false,
      recordArm: false,
      monitor: false,
      stereoMode: true,
      faderDb: 0.0,
      automationMode: 'Off',
      inserts: [],
      sends: [],
      inputSource: 'none',
      inputChannelIndex: nextIdx,
    };
    const firstMasterIdx = channels.findIndex((c) => c.type === 'master' || c.type === 'listen');
    const updated = [...channels];
    updated.splice(firstMasterIdx === -1 ? updated.length : firstMasterIdx, 0, newTrack);
    setChannels(updated);
    setSelectedChannelId(newTrack.id);
  };

  const handleAddFxChannel = () => {
    const trackChannels = channels.filter((c) => c.type === 'audio' || c.type === 'fx');
    const nextIdx = trackChannels.length + 1;
    const fxCount = channels.filter((c) => c.type === 'fx').length + 1;
    const newFx: ChannelState = {
      id: `fx-custom-${Date.now()}`,
      index: nextIdx,
      name: `FX ${fxCount}`,
      type: 'fx',
      stripColor: '#d97706',
      neonAccent: '#fbbf24',
      tintBg: 'rgba(120, 53, 15, 0.2)',
      inputGainDb: 0.0,
      polarityLeft: false,
      polarityRight: false,
      pan: 0,
      mute: false,
      solo: false,
      recordArm: false,
      monitor: false,
      stereoMode: true,
      faderDb: -4.0,
      automationMode: 'Off',
      inserts: [
        {
          id: `ins-fx-${Date.now()}`,
          name: 'VintageVerb',
          format: 'VST3',
          vendor: 'Valhalla DSP',
          type: 'reverb',
          enabled: true,
          params: { decay: 2.6, preDelay: 22, damping: 45, mix: 100 },
        },
      ],
      sends: [],
      inputSource: 'none',
      inputChannelIndex: 0,
    };
    const firstMasterIdx = channels.findIndex((c) => c.type === 'master' || c.type === 'listen');
    const updated = [...channels];
    updated.splice(firstMasterIdx === -1 ? updated.length : firstMasterIdx, 0, newFx);
    setChannels(updated);
    setSelectedChannelId(newFx.id);
  };

  const handleDeleteChannel = (channelId: string) => {
    setChannels((prev) => {
      const filtered = prev.filter((c) => c.id !== channelId);
      let idx = 1;
      return filtered.map((c) =>
        c.type === 'audio' || c.type === 'fx' ? { ...c, index: idx++ } : c
      );
    });
  };

  const handleApplyAudioSettings = async (
    sampleRate: 44100 | 48000 | 88200 | 96000,
    outputDeviceId: string
  ) => {
    const wasPlaying = transport.isPlaying;
    if (wasPlaying) audioEngine.stopPlayback();
    const { baseLatencyMs, outputLatencyMs } = await audioEngine.rebuildSampleRate(sampleRate, channels);
    await audioEngine.setOutputDevice(outputDeviceId);
    setAsioConfig((prev) => ({
      ...prev,
      baseLatencyMs,
      outputLatencyMs,
    }));
    if (wasPlaying) {
      await audioEngine.startPlayback(transport, channels, { ...asioConfig, sampleRate });
    }
  };

  const fxBuses = channels.filter((c) => c.type === 'fx');
  const scrollableStrips = channels.filter((c) => c.type === 'audio' || c.type === 'fx');
  const masterStrips = channels.filter((c) => c.type === 'master' || c.type === 'listen');

  const activeChannel = activePluginRef
    ? channels.find((c) => c.id === activePluginRef.channelId) ?? null
    : null;
  const activePlugin =
    activeChannel && activePluginRef
      ? activeChannel.inserts.find((i) => i.id === activePluginRef.pluginId) ?? null
      : null;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#080a0f] text-slate-100 overflow-hidden">
      {/* Top DAW Bar */}
      <TopTransportBar
        asioConfig={asioConfig}
        cpuMetrics={cpuMetrics}
        recordedAudioUrl={recordedAudioUrl}
        onOpenAsioModal={() => setShowAsioModal(true)}
        onOpenDesktopModal={() => setShowDesktopModal(true)}
        isDesktopInstallable={isInstallable}
        isElectronDesktop={isElectron}
      />

      {/* Main Virtual Mixer Console */}
      <main className="flex-1 flex min-h-0 overflow-hidden bg-[#080a0f]">
        {/* Scrollable Audio + FX Bus Strips */}
        <div className="flex-1 flex overflow-x-auto overflow-y-hidden console-scroll min-w-0">
          {scrollableStrips.map((ch) => (
            <ChannelStrip
              key={ch.id}
              channel={ch}
              fxBuses={fxBuses}
              allChannels={channels}
              asioConfig={asioConfig}
              inputDevices={inputDevices}
              isSelected={selectedChannelId === ch.id}
              meter={meters[ch.id] ?? { left: 0, right: 0, peakDb: -60, clipped: false }}
              canDelete={ch.index > 8}
              onSelect={() => setSelectedChannelId(ch.id)}
              onUpdate={(updater) => updateChannel(ch.id, updater)}
              onDeleteChannel={() => handleDeleteChannel(ch.id)}
              onOpenPlugin={(channelId, plugin) =>
                setActivePluginRef({ channelId, pluginId: plugin.id })
              }
              onResetClip={() => audioEngine.clearClip(ch.id)}
              onLoadFile={handleLoadFile}
              onToggleMic={handleToggleMic}
              onSelectInput={handleSelectInput}
            />
          ))}

          {/* Inline Add Channel Strip Slot */}
          <div className="w-[78px] shrink-0 h-full border-r border-[#1c2331] bg-[#090c12] flex flex-col items-center justify-center gap-2.5 p-2 select-none">
            <button
              type="button"
              onClick={handleAddAudioTrack}
              className="w-full py-2.5 px-1.5 rounded bg-[#111724] hover:bg-cyan-500/15 border border-dashed border-cyan-500/40 hover:border-cyan-400 text-cyan-300 flex flex-col items-center gap-1 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="text-[10px] font-semibold leading-tight text-center">
                + Audio Ch
              </span>
            </button>
            <button
              type="button"
              onClick={handleAddFxChannel}
              className="w-full py-2 px-1.5 rounded bg-[#111724] hover:bg-amber-500/15 border border-dashed border-amber-500/40 hover:border-amber-400 text-amber-300 flex flex-col items-center gap-1 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="text-[9.5px] font-semibold leading-tight text-center">
                + FX Bus
              </span>
            </button>
          </div>
        </div>

        {/* Pinned Right Master & Cue/Listen Section (Main + TTLS) */}
        <div className="flex shrink-0 border-l-2 border-[#1e2738] bg-[#0b0e15] shadow-[-8px_0_24px_rgba(0,0,0,0.65)]">
          {masterStrips.map((ch) => (
            <ChannelStrip
              key={ch.id}
              channel={ch}
              fxBuses={fxBuses}
              allChannels={channels}
              asioConfig={asioConfig}
              isSelected={selectedChannelId === ch.id}
              meter={meters[ch.id] ?? { left: 0, right: 0, peakDb: -60, clipped: false }}
              onSelect={() => setSelectedChannelId(ch.id)}
              onUpdate={(updater) => updateChannel(ch.id, updater)}
              onOpenPlugin={(channelId, plugin) =>
                setActivePluginRef({ channelId, pluginId: plugin.id })
              }
              onResetClip={() => audioEngine.clearClip(ch.id)}
              onLoadFile={handleLoadFile}
              onToggleMic={handleToggleMic}
            />
          ))}
        </div>
      </main>

      {/* DSP Plugin Inspector Modal */}
      {activeChannel && activePlugin && (
        <PluginModal
          channel={activeChannel}
          plugin={activePlugin}
          onClose={() => setActivePluginRef(null)}
          onUpdatePlugin={handleUpdatePlugin}
        />
      )}

      {/* ASIO Driver & Audio I/O Configuration Modal */}
      {showAsioModal && (
        <AsioSettingsModal
          config={asioConfig}
          onClose={() => setShowAsioModal(false)}
          onUpdateConfig={(next) => setAsioConfig((prev) => ({ ...prev, ...next }))}
          onApplyAudioSettings={handleApplyAudioSettings}
        />
      )}

      {/* Windows PC / .EXE Desktop Packaging & Install Modal */}
      <DesktopExeModal
        isOpen={showDesktopModal}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        isElectron={isElectron}
        onInstallDesktop={installDesktopApp}
        onClose={() => setShowDesktopModal(false)}
      />

      {!isOnline && (
        <div className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-md bg-amber-500/95 px-3 py-1.5 text-[11px] font-semibold text-slate-950 shadow-lg">
          <span className="h-2 w-2 rounded-full bg-slate-950 animate-pulse" />
          Mode Offline — Aplikasi berjalan dari cache lokal
        </div>
      )}
    </div>
  );
}
