import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { audioEngine } from './audio/AudioEngine';
import { AsioSettingsModal } from './components/AsioSettingsModal';
import { ChannelStrip } from './components/ChannelStrip';
import { DesktopExeModal } from './components/DesktopExeModal';
import { PluginModal } from './components/PluginModal';
import { SpecialEffectPanel } from './components/SpecialEffectPanel';
import { ThemeSettingsModal } from './components/ThemeSettingsModal';
import { CpuMonitorMetrics, TopTransportBar } from './components/TopTransportBar';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import {
  INITIAL_ASIO_CONFIG,
  INITIAL_CHANNELS,
  INITIAL_SPECIAL_EFFECT_PADS,
  INITIAL_TRANSPORT,
  PLUGIN_CATALOG,
} from './data/defaultSession';
import { applyThemeToDocument, resolveThemePreset } from './data/themes';
import {
  AsioDriverConfig,
  AudioDeviceInfo,
  ChannelState,
  InputSourceType,
  InsertPlugin,
  MeterReading,
  SpecialEffectPad,
  ThemePreset,
  ThemePresetId,
  TransportState,
} from './types/mixer';

const STORAGE_KEY = 'govimix-session-v12';
const LEGACY_STORAGE_KEY = 'govimix-session-v11';

function readStoredSession(): Record<string, unknown> | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved) as Record<string, unknown>;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export default function App() {
  const [themePresetId, setThemePresetId] = useState<ThemePresetId>(() => {
    const parsed = readStoredSession();
    const id = parsed?.themePresetId;
    if (typeof id === 'string') return id as ThemePresetId;
    return 'neon-yellow';
  });

  const [customNeonHex, setCustomNeonHex] = useState<string>(() => {
    const parsed = readStoredSession();
    const hex = parsed?.customNeonHex;
    return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#eaff00';
  });

  const activeTheme = resolveThemePreset(themePresetId, customNeonHex);

  const [channels, setChannels] = useState<ChannelState[]>(() => {
    const parsed = readStoredSession();
    const initTheme = resolveThemePreset(
      typeof parsed?.themePresetId === 'string'
        ? (parsed.themePresetId as ThemePresetId)
        : 'neon-yellow',
      typeof parsed?.customNeonHex === 'string' ? parsed.customNeonHex : '#eaff00'
    );
    const themeColor = {
      stripColor: initTheme.neon,
      neonAccent: initTheme.neon,
      tintBg: initTheme.tintBg,
    };
    if (parsed && Array.isArray(parsed.channels) && parsed.channels.length > 0) {
      return (parsed.channels as ChannelState[]).map((ch) => {
        // In-memory File AudioBuffers do not persist across browser reloads
        if (ch.inputSource === 'file') {
          const fallbackDemo = ch.id === 'ch-2' || ch.id === 'ch-3';
          return {
            ...ch,
            ...themeColor,
            inputSource: fallbackDemo ? 'demo' : 'none',
            inputLabel: fallbackDemo ? `Stem In ${ch.index}` : 'None',
            audioFileName: undefined,
          };
        }
        return {
          ...ch,
          ...themeColor,
        };
      });
    }
    return INITIAL_CHANNELS.map((ch) => ({ ...ch, ...themeColor }));
  });

  const [asioConfig, setAsioConfig] = useState<AsioDriverConfig>(() => {
    const parsed = readStoredSession();
    if (parsed?.asioConfig && typeof parsed.asioConfig === 'object') {
      return {
        ...INITIAL_ASIO_CONFIG,
        ...(parsed.asioConfig as Partial<AsioDriverConfig>),
        bridgeConnected: false,
      };
    }
    return INITIAL_ASIO_CONFIG;
  });

  const [specialEffectPads, setSpecialEffectPads] = useState<SpecialEffectPad[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.specialEffectPads) && parsed.specialEffectPads.length > 0) {
          if (parsed.specialEffectPads.length >= INITIAL_SPECIAL_EFFECT_PADS.length) {
            return parsed.specialEffectPads.slice(0, INITIAL_SPECIAL_EFFECT_PADS.length);
          }
          const existingIds = new Set(parsed.specialEffectPads.map((p: SpecialEffectPad) => p.id));
          return [
            ...parsed.specialEffectPads,
            ...INITIAL_SPECIAL_EFFECT_PADS.filter((p) => !existingIds.has(p.id)),
          ];
        }
      }
    } catch {
      // ignore
    }
    return INITIAL_SPECIAL_EFFECT_PADS;
  });

  const [transport, setTransport] = useState<TransportState>(INITIAL_TRANSPORT);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('ch-3');
  const [showAsioModal, setShowAsioModal] = useState(false);
  const [showDesktopModal, setShowDesktopModal] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [activePluginRef, setActivePluginRef] = useState<{ channelId: string; pluginId: string } | null>(null);
  const { isInstallable, isInstalled, isElectron, install: installDesktopApp } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [meters, setMeters] = useState<Record<string, MeterReading>>({});
  const [recordedAudioUrl] = useState<string | null>(null);
  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [audioNotice, setAudioNotice] = useState<string | null>(null);
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

    let unlocked = false;
    const unlockLiveAudio = async () => {
      if (unlocked) return;
      unlocked = true;
      try {
        await audioEngine.ensureContext(asioConfigRef.current.sampleRate);
        audioEngine.rebuildGraph(channelsRef.current);
        for (const ch of channelsRef.current) {
          if (ch.type === 'audio' && ch.inputSource === 'mic' && ch.monitor && !audioEngine.hasActiveLiveStream(ch.id)) {
            await audioEngine.enableLiveMicInput(
              ch.id,
              ch.inputDeviceId ?? asioConfigRef.current.inputDeviceId,
              true
            );
          }
        }
      } catch {
        // Browser may require explicit interaction before resuming AudioContext
        unlocked = false;
      }
    };

    // Attempt immediate initialization (works immediately in Electron .exe)
    unlockLiveAudio();

    const onFirstGesture = () => {
      unlockLiveAudio();
    };
    window.addEventListener('pointerdown', onFirstGesture, { passive: true });
    window.addEventListener('keydown', onFirstGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
  }, []);

  // Apply active theme CSS custom properties
  useEffect(() => {
    applyThemeToDocument(activeTheme);
  }, [activeTheme]);

  // Persist mixer, special effect pads, theme & ASIO preferences
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          channels,
          asioConfig,
          specialEffectPads,
          themePresetId,
          customNeonHex,
        })
      );
    } catch {
      // ignore quota errors
    }
  }, [channels, asioConfig, specialEffectPads, themePresetId, customNeonHex]);

  // Sync audio parameters whenever channels change
  useEffect(() => {
    if (audioEngine.isInitialized()) {
      audioEngine.rebuildGraph(channels);
    }
  }, [channels]);

  useEffect(() => {
    audioEngine.updateTransportSnapshot(transport);
  }, [transport]);

  // Real-time Metering & CPU Monitor Loop
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const frameDeltaMs =
        lastFrameTimeRef.current !== null ? now - lastFrameTimeRef.current : 16.67;
      lastFrameTimeRef.current = now;

      if (audioEngine.isInitialized()) {
        setMeters(audioEngine.sampleMeters(channelsRef.current));
      }

      if (now - lastCpuSampleRef.current >= 350) {
        lastCpuSampleRef.current = now;
        const anyActiveAudio =
          transportRef.current.isPlaying ||
          channelsRef.current.some(
            (c) => c.type === 'audio' && c.monitor && (c.inputSource === 'mic' || c.inputSource === 'app' || c.inputSource === 'file')
          );
        setCpuMetrics(
          audioEngine.getDspCpuMetrics(
            channelsRef.current,
            asioConfigRef.current,
            anyActiveAudio,
            frameDeltaMs
          )
        );
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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

  const showTemporaryNotice = (msg: string) => {
    setAudioNotice(msg);
    window.setTimeout(() => {
      setAudioNotice((cur) => (cur === msg ? null : cur));
    }, 5000);
  };

  const handleToggleMic = async (channelId: string) => {
    const target = channelsRef.current.find((c) => c.id === channelId);
    if (!target) return;
    const nextMonitor = !target.monitor;
    await audioEngine.ensureContext(asioConfigRef.current.sampleRate);
    audioEngine.rebuildGraph(channelsRef.current);

    if (target.inputSource === 'mic') {
      await audioEngine.enableLiveMicInput(
        channelId,
        target.inputDeviceId ?? asioConfigRef.current.inputDeviceId,
        nextMonitor
      );
    } else if (target.inputSource === 'app') {
      if (nextMonitor) {
        if (!audioEngine.hasActiveLiveStream(channelId)) {
          const ok = await audioEngine.enableApplicationAudioInput(channelId, () => {
            updateChannel(channelId, (c) => ({ ...c, monitor: false }));
          });
          if (!ok) {
            showTemporaryNotice('Centang "Share audio" / "Share system audio" agar audio aplikasi langsung masuk.');
            return;
          }
        }
      } else {
        await audioEngine.enableLiveMicInput(channelId, undefined, false);
      }
    } else if (target.inputSource === 'file') {
      if (nextMonitor) {
        await audioEngine.playFileForChannel(channelId, asioConfigRef.current.sampleRate, true);
      } else {
        audioEngine.stopFileForChannel(channelId);
      }
    } else if (target.inputSource === 'demo') {
      if (nextMonitor) {
        const nextT = { ...transportRef.current, isPlaying: true };
        setTransport(nextT);
        await audioEngine.startPlayback(nextT, channelsRef.current, asioConfigRef.current);
      } else {
        audioEngine.stopPlayback();
        setTransport((t) => ({ ...t, isPlaying: false }));
      }
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
    await audioEngine.ensureContext(asioConfigRef.current.sampleRate);
    audioEngine.rebuildGraph(channelsRef.current);
    audioEngine.stopFileForChannel(channelId);

    if (source === 'mic') {
      const targetDev = deviceId ?? asioConfigRef.current.inputDeviceId;
      await audioEngine.enableLiveMicInput(channelId, targetDev, true);
      const devs = await audioEngine.enumerateHardwareDevices(false);
      setInputDevices(devs.filter((d) => d.kind === 'audioinput'));
    } else if (source === 'app') {
      const ok = await audioEngine.enableApplicationAudioInput(channelId, () => {
        updateChannel(channelId, (c) => ({ ...c, monitor: false }));
      });
      if (!ok) {
        showTemporaryNotice('Audio aplikasi belum terpilih. Centang "Share audio" / "Share system audio" di popup.');
        return;
      }
    } else {
      await audioEngine.enableLiveMicInput(channelId, undefined, false);
    }

    const nextChannels = channelsRef.current.map((c) =>
      c.id === channelId
        ? {
            ...c,
            inputSource: source,
            inputChannelIndex: channelIndex,
            inputLabel: label,
            inputDeviceId: deviceId,
            monitor: source === 'mic' || source === 'app' || source === 'demo' ? true : false,
            mute: source === 'none' ? c.mute : false,
          }
        : c
    );
    channelsRef.current = nextChannels;
    setChannels(nextChannels);

    if (source === 'demo') {
      const nextT = { ...transportRef.current, isPlaying: true };
      setTransport(nextT);
      await audioEngine.startPlayback(nextT, nextChannels, asioConfigRef.current);
    } else if (!nextChannels.some((c) => c.inputSource === 'demo' && c.monitor)) {
      audioEngine.stopPlayback();
      setTransport((t) => ({ ...t, isPlaying: false }));
    }
  };

  const handleLoadFile = async (channelId: string, file: File) => {
    const res = await audioEngine.loadAudioFileForChannel(channelId, file);
    if (!res) return;
    const nextChannels = channelsRef.current.map((c) =>
      c.id === channelId
        ? {
            ...c,
            inputSource: 'file' as InputSourceType,
            inputLabel: file.name,
            audioFileName: file.name,
            monitor: true,
            mute: false,
          }
        : c
    );
    channelsRef.current = nextChannels;
    setChannels(nextChannels);
    await audioEngine.playFileForChannel(channelId, asioConfigRef.current.sampleRate, true);
  };

  const applyThemeToChannels = (nextTheme: ThemePreset) => {
    setChannels((prev) =>
      prev.map((ch) => ({
        ...ch,
        stripColor: nextTheme.neon,
        neonAccent: nextTheme.neon,
        tintBg: nextTheme.tintBg,
      }))
    );
  };

  const handleSelectThemePreset = (presetId: ThemePresetId) => {
    setThemePresetId(presetId);
    const nextTheme = resolveThemePreset(presetId, customNeonHex);
    applyThemeToChannels(nextTheme);
  };

  const handleSelectCustomThemeColor = (hexColor: string) => {
    setCustomNeonHex(hexColor);
    setThemePresetId('custom');
    const nextTheme = resolveThemePreset('custom', hexColor);
    applyThemeToChannels(nextTheme);
  };

  const handleAddAudioTrack = () => {
    const trackChannels = channels.filter((c) => c.type === 'audio' || c.type === 'fx');
    const nextIdx = trackChannels.length + 1;
    const newTrack: ChannelState = {
      id: `ch-custom-${Date.now()}`,
      index: nextIdx,
      name: '',
      type: 'audio',
      stripColor: activeTheme.neon,
      neonAccent: activeTheme.neon,
      tintBg: activeTheme.tintBg,
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
      stripColor: activeTheme.neon,
      neonAccent: activeTheme.neon,
      tintBg: activeTheme.tintBg,
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
    for (const ch of channelsRef.current) {
      if (ch.type === 'audio' && ch.monitor) {
        if (ch.inputSource === 'mic') {
          await audioEngine.enableLiveMicInput(ch.id, ch.inputDeviceId ?? asioConfig.inputDeviceId, true);
        } else if (ch.inputSource === 'file') {
          await audioEngine.playFileForChannel(ch.id, sampleRate, true);
        }
      }
    }
    if (wasPlaying) {
      await audioEngine.startPlayback(transport, channels, { ...asioConfig, sampleRate });
    }
  };

  const handleTriggerSfxPad = async (pad: SpecialEffectPad) => {
    await audioEngine.ensureContext(asioConfig.sampleRate);
    audioEngine.rebuildGraph(channelsRef.current);
    await audioEngine.triggerSpecialEffectPad(pad, 'ch-7', channelsRef.current);
  };

  const handleUpdateSfxPad = (
    padId: string,
    updater: (prev: SpecialEffectPad) => SpecialEffectPad
  ) => {
    setSpecialEffectPads((prev) => prev.map((p) => (p.id === padId ? updater(p) : p)));
  };

  const handleResetSfxPad = (padId: string) => {
    const def = INITIAL_SPECIAL_EFFECT_PADS.find((p) => p.id === padId);
    if (!def) return;
    audioEngine.clearSpecialEffectAudio(padId);
    setSpecialEffectPads((prev) => prev.map((p) => (p.id === padId ? { ...def } : p)));
  };

  const handleUploadSfxAudio = async (padId: string, file: File) => {
    const fileName = await audioEngine.loadSpecialEffectAudio(padId, file);
    if (!fileName) return;
    const shortLabel = fileName.replace(/\.[^/.]+$/, '').slice(0, 16);
    handleUpdateSfxPad(padId, (p) => ({
      ...p,
      preset: 'custom',
      audioFileName: fileName,
      label: shortLabel || p.label,
    }));
  };

  const handleClearSfxAudio = (padId: string) => {
    audioEngine.clearSpecialEffectAudio(padId);
    handleUpdateSfxPad(padId, (p) => ({
      ...p,
      audioFileName: undefined,
    }));
  };

  const handleOpenSpecialEffectPlugin = () => {
    const ch7 = channels.find((c) => c.id === 'ch-7');
    if (!ch7) return;
    const existing = ch7.inserts.find((i) => i.type === 'special-fx');
    if (existing) {
      setActivePluginRef({ channelId: ch7.id, pluginId: existing.id });
      return;
    }
    const catalogItem = PLUGIN_CATALOG.find((p) => p.type === 'special-fx');
    const newPlugin: InsertPlugin = {
      id: `ins-7-${Date.now()}`,
      name: catalogItem?.name ?? 'Special Effect',
      format: catalogItem?.format ?? 'VST3',
      vendor: catalogItem?.vendor ?? 'GoViMix DSP',
      type: 'special-fx',
      enabled: true,
      params: { ...(catalogItem?.defaultParams ?? { pitch: 0, tone: 4200, drive: 18, mix: 100 }) },
    };
    updateChannel(ch7.id, (c) => ({ ...c, inserts: [...c.inserts, newPlugin] }));
    setActivePluginRef({ channelId: ch7.id, pluginId: newPlugin.id });
  };

  const ch7 = channels.find((c) => c.id === 'ch-7');
  const ch7SfxPlugin = ch7?.inserts.find((i) => i.type === 'special-fx');

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
    <div
      className="h-screen w-screen flex flex-col text-slate-100 overflow-hidden"
      style={{ backgroundColor: 'var(--theme-bg-main)' }}
    >
      {/* Top DAW Bar */}
      <TopTransportBar
        asioConfig={asioConfig}
        cpuMetrics={cpuMetrics}
        recordedAudioUrl={recordedAudioUrl}
        activeTheme={activeTheme}
        onOpenThemeModal={() => setShowThemeModal(true)}
        onOpenAsioModal={() => setShowAsioModal(true)}
        onOpenDesktopModal={() => setShowDesktopModal(true)}
        isDesktopInstallable={isInstallable}
        isElectronDesktop={isElectron}
      />

      {/* Main Virtual Mixer Console */}
      <main
        className="flex-1 flex min-h-0 overflow-hidden"
        style={{ backgroundColor: 'var(--theme-bg-main)' }}
      >
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
          <div
            className="w-[78px] shrink-0 h-full border-r border-[#1c2331] flex flex-col items-center justify-center gap-2.5 p-2 select-none"
            style={{ backgroundColor: 'var(--theme-bg-panel)' }}
          >
            <button
              type="button"
              onClick={handleAddAudioTrack}
              className="w-full py-2.5 px-1.5 rounded bg-[#111724] hover:bg-[rgba(var(--theme-neon-rgb),0.15)] border border-dashed border-[rgba(var(--theme-neon-rgb),0.45)] hover:border-[var(--theme-neon)] text-[var(--theme-neon-soft)] flex flex-col items-center gap-1 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="text-[10px] font-semibold leading-tight text-center">
                + Audio Ch
              </span>
            </button>
            <button
              type="button"
              onClick={handleAddFxChannel}
              className="w-full py-2 px-1.5 rounded bg-[#111724] hover:bg-[rgba(var(--theme-neon-rgb),0.15)] border border-dashed border-[rgba(var(--theme-neon-rgb),0.45)] hover:border-[var(--theme-neon)] text-[var(--theme-neon-soft)] flex flex-col items-center gap-1 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="text-[9.5px] font-semibold leading-tight text-center">
                + FX Bus
              </span>
            </button>
          </div>
        </div>

        {/* Pinned Right Master & Cue/Listen Section (Main + TTLS) */}
        <div
          className="flex shrink-0 border-l-2 border-[#1e2738] shadow-[-8px_0_24px_rgba(0,0,0,0.65)]"
          style={{ backgroundColor: 'var(--theme-bg-panel)' }}
        >
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

        {/* Right-side Docked 20-Pad Editable Special Effect Panel (Routed to Ch 7) */}
        <SpecialEffectPanel
          pads={specialEffectPads}
          channelName={ch7?.name || 'SPECIAL EFF'}
          pluginEnabled={ch7SfxPlugin ? ch7SfxPlugin.enabled : true}
          onTriggerPad={handleTriggerSfxPad}
          onUpdatePad={handleUpdateSfxPad}
          onResetPad={handleResetSfxPad}
          onUploadAudio={handleUploadSfxAudio}
          onClearAudio={handleClearSfxAudio}
          onStopAll={() => audioEngine.stopAllSpecialEffects()}
          onOpenPlugin={handleOpenSpecialEffectPlugin}
        />
      </main>

      {/* DSP Plugin Inspector Modal */}
      {activeChannel && activePlugin && (
        <PluginModal
          channel={activeChannel}
          plugin={activePlugin}
          sfxPads={specialEffectPads}
          onTriggerSfxPad={handleTriggerSfxPad}
          onStopAllSfx={() => audioEngine.stopAllSpecialEffects()}
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

      {/* Theme & Color Preset Settings Modal */}
      {showThemeModal && (
        <ThemeSettingsModal
          activeTheme={activeTheme}
          customHex={customNeonHex}
          onSelectPreset={handleSelectThemePreset}
          onSelectCustomColor={handleSelectCustomThemeColor}
          onClose={() => setShowThemeModal(false)}
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

      {audioNotice && (
        <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-md bg-[#121826] border border-[rgba(var(--theme-neon-rgb),0.55)] px-3 py-2 text-[11px] font-medium text-[var(--theme-neon-soft)] shadow-xl">
          <span>{audioNotice}</span>
        </div>
      )}
    </div>
  );
}
