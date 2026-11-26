export type ChannelType = 'audio' | 'fx' | 'master' | 'listen';

export type PluginFormat = 'VST3' | 'AAX' | 'VST2';

export type PluginType =
  | 'pro-q'
  | 'pro-eq'
  | 'compressor'
  | 'gate'
  | 'reverb'
  | 'delay'
  | 'megaphone'
  | 'limiter'
  | 'spectrum'
  | 'harmony'
  | 'meter'
  | 'wider'
  | 'ducking'
  | 'multiband'
  | 'saturation'
  | 'special-fx';

export type SpecialEffectPreset =
  | 'airhorn'
  | 'applause'
  | 'laser'
  | 'riser'
  | 'subdrop'
  | 'vinyl-stop'
  | 'siren'
  | 'laugh'
  | 'bell'
  | 'whoosh'
  | 'glitch'
  | 'boom'
  | 'chime'
  | 'buzzer'
  | 'scratch'
  | 'drumroll'
  | 'echo-hit'
  | 'fanfare'
  | 'robot'
  | 'clap'
  | 'cowbell'
  | 'crash'
  | 'sweep-down'
  | 'alarm'
  | 'boing'
  | 'coin'
  | 'zap'
  | 'gong'
  | 'powerup'
  | 'custom';

export interface SpecialEffectPad {
  id: string;
  index: number;
  label: string;
  preset: SpecialEffectPreset;
  pitchSemitones: number;
  durationMs: number;
  volumeDb: number;
  audioFileName?: string;
}

export type AutomationMode = 'Off' | 'Read' | 'Touch' | 'Latch' | 'Write';

export interface InsertPlugin {
  id: string;
  name: string;
  format: PluginFormat;
  vendor: string;
  type: PluginType;
  enabled: boolean;
  params: Record<string, number>;
  bundlePath?: string;
}

export interface PluginCatalogItem {
  name: string;
  format: PluginFormat;
  vendor: string;
  type: PluginType;
  defaultParams: Record<string, number>;
}

export interface SendSlot {
  id: string;
  targetBusId: string;
  targetName: string;
  levelDb: number; // -60 to +6
  enabled: boolean;
  preFader: boolean;
}

export type InputSourceType = 'demo' | 'mic' | 'file' | 'bus' | 'app' | 'none';

export type OutputTargetType = 'master' | 'bus' | 'hardware' | 'none';

export type MicChannelMode = 'mono-lr' | 'left' | 'right' | 'stereo';

export interface ChannelState {
  id: string;
  index: number;
  name: string;
  type: ChannelType;
  stripColor: string;
  neonAccent: string;
  tintBg: string;
  inputGainDb: number; // -24 to +24
  polarityLeft: boolean;
  polarityRight: boolean;
  pan: number; // -100 to +100
  mute: boolean;
  solo: boolean;
  recordArm: boolean;
  monitor: boolean;
  stereoMode: boolean;
  faderDb: number; // -60 to +10 (-60 treated as -inf)
  automationMode: AutomationMode;
  inserts: InsertPlugin[];
  sends: SendSlot[];
  inputSource: InputSourceType;
  inputChannelIndex: number; // e.g., ASIO In 1..8
  inputDeviceId?: string;
  inputLabel?: string;
  audioFileName?: string;
  micChannelMode?: MicChannelMode;
  outputTargetType?: OutputTargetType;
  outputTargetId?: string;
  outputLabel?: string;
}

export type AsioDriverMode = 'asio-native-bridge' | 'asio4all-router' | 'webaudio-interactive';

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  groupId: string;
}

export type AudioDeviceTypeLabel =
  | 'ASIO'
  | 'Windows Audio'
  | 'Windows Audio (Exclusive Mode)'
  | 'DirectSound';

export interface AsioDriverConfig {
  driverMode: AsioDriverMode;
  deviceType?: AudioDeviceTypeLabel;
  bridgeUrl: string;
  bridgeConnected: boolean;
  bridgeStatusText: string;
  activeDeviceName: string;
  inputDeviceId: string;
  outputDeviceId: string;
  activeOutputChannels?: string[];
  activeInputChannels?: string[];
  activeMidiInputs?: string[];
  midiOutput?: string;
  sampleRate: 44100 | 48000 | 88200 | 96000;
  bufferSize: 32 | 64 | 128 | 256 | 512 | 1024;
  bitDepth: 24 | 32;
  inputChannels: number;
  outputChannels: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
  releaseInBackground?: boolean;
}

export interface TransportState {
  isPlaying: boolean;
  isRecording: boolean;
  isLooping: boolean;
  metronomeOn: boolean;
  bpm: number;
  timeSigNum: number;
  timeSigDen: number;
  currentTimeSec: number;
  loopStartSec: number;
  loopEndSec: number;
}

export interface ArrangementClip {
  id: string;
  channelId: string;
  name: string;
  startSec: number;
  durationSec: number;
  color: string;
  peaks: number[];
}

export interface MeterReading {
  left: number; // 0..1 normalized
  right: number; // 0..1 normalized
  peakDb: number;
  clipped: boolean;
}

export type ThemePresetId =
  | 'neon-yellow'
  | 'cyber-cyan'
  | 'emerald-matrix'
  | 'plasma-magenta'
  | 'amber-gold'
  | 'crimson-studio'
  | 'custom';

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  description: string;
  neon: string;
  neonSoft: string;
  neonRgb: string;
  tintBg: string;
  bgMain: string;
  bgPanel: string;
  meterMid: string;
}
