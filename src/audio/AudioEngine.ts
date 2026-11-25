import {
  AsioDriverConfig,
  AudioDeviceInfo,
  ChannelState,
  MeterReading,
  SpecialEffectPad,
  SpecialEffectPreset,
  TransportState,
} from '../types/mixer';

interface ChannelNodes {
  inputGain: GainNode;
  lowFilter: BiquadFilterNode;
  midFilter: BiquadFilterNode;
  highFilter: BiquadFilterNode;
  megaphoneFilter: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  revPreDelay?: DelayNode;
  revDryGain: GainNode;
  revWetGain?: GainNode;
  delayWetGain?: GainNode;
  harmonyWetGain?: GainNode;
  harmonyVoiceGains: GainNode[];
  harmonyLfoOscs: OscillatorNode[];
  panner: StereoPannerNode;
  faderGain: GainNode;
  fxConvolver?: ConvolverNode;
  fxDelay?: DelayNode;
  fxFeedback?: GainNode;
  fxTone?: BiquadFilterNode;
  reverbBranchWired?: boolean;
  delayBranchWired?: boolean;
  harmonyBranchWired?: boolean;
  splitter: ChannelSplitterNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
  outputRouterGain: GainNode;
  outRouteKey?: string;
  directSinkDest?: MediaStreamAudioDestinationNode;
  directSinkAudio?: HTMLAudioElement;
  directSinkDeviceId?: string;
  sendGains: Map<string, GainNode>;
  micSource?: MediaStreamAudioSourceNode;
  micStream?: MediaStream;
  micDeviceId?: string;
  micSplitter?: ChannelSplitterNode;
  micMerger?: ChannelMergerNode;
  micGainLL?: GainNode;
  micGainLR?: GainNode;
  micGainRL?: GainNode;
  micGainRR?: GainNode;
}

export function dbToLinear(db: number): number {
  if (db <= -59.5) return 0;
  return Math.pow(10, db / 20);
}

export function linearToDb(lin: number): number {
  if (lin <= 0.00001) return -60;
  return Math.max(-60, Math.min(12, 20 * Math.log10(lin)));
}

function createImpulseResponse(
  ctx: AudioContext,
  durationSec: number,
  decay: number,
  dampingHz: number
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    let lp = 0;
    const alpha = Math.min(0.98, Math.max(0.1, dampingHz / sampleRate * 4));
    for (let i = 0; i < length; i++) {
      const n = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      lp = lp + alpha * (n - lp);
      data[i] = lp;
    }
  }
  return impulse;
}

export class StudioAudioEngine {
  private ctx: AudioContext | null = null;
  private channelNodes = new Map<string, ChannelNodes>();
  private customBuffers = new Map<string, AudioBuffer>();
  private channelFileSources = new Map<string, AudioBufferSourceNode>();
  private sfxBuffers = new Map<string, AudioBuffer>();
  private activeBufferSources: AudioBufferSourceNode[] = [];
  private activeSfxSources: AudioScheduledSourceNode[] = [];
  private schedulerTimer: number | null = null;
  private nextStepTime = 0;
  private currentStep = 0;
  private channelsSnapshot: ChannelState[] = [];
  private transportSnapshot: TransportState | null = null;
  private peakClips = new Map<string, boolean>();
  private timeBufL = new Float32Array(256);
  private timeBufR = new Float32Array(256);
  private fftBuf = new Uint8Array(1024);

  // Recording state
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordDest: MediaStreamAudioDestinationNode | null = null;

  // Hardware output routing state
  private currentOutputDeviceId = 'default';
  private appliedSinkId = '';
  private currentBufferSize = 256;
  private masterOutputEnabled = true;
  private masterOutputGain: GainNode | null = null;
  private lastOutputError: string | null = null;
  private lastAppCaptureError: string | null = null;

  // ASIO Bridge WebSocket
  private asioSocket: WebSocket | null = null;

  private getLatencyHintForBuffer(bufferSize: number): AudioContextLatencyCategory {
    if (bufferSize <= 64) return 'interactive';
    if (bufferSize <= 256) return 'balanced';
    return 'playback';
  }

  public isInitialized(): boolean {
    return this.ctx !== null;
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public getContextState(): AudioContextState | 'uninitialized' {
    return this.ctx ? this.ctx.state : 'uninitialized';
  }

  public async ensureContext(sampleRate: number = 48000, bufferSize?: number): Promise<AudioContext> {
    if (bufferSize !== undefined) {
      this.currentBufferSize = bufferSize;
    }
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const latencyHint = this.getLatencyHintForBuffer(this.currentBufferSize);
      try {
        this.ctx = new AudioCtx({
          latencyHint,
          sampleRate,
        });
      } catch {
        this.ctx = new AudioCtx({
          latencyHint,
        });
      }
      this.appliedSinkId = '';
      if (this.channelsSnapshot.length > 0) {
        this.rebuildGraph(this.channelsSnapshot);
      }
      if (this.currentOutputDeviceId && this.currentOutputDeviceId !== 'default') {
        void this.setOutputDevice(this.currentOutputDeviceId);
      }
    }
    if (this.ctx.state === 'suspended') {
      await this.resumeIfNeeded(false);
    }
    return this.ctx;
  }

  public async resumeIfNeeded(fromGesture = false): Promise<boolean> {
    if (!this.ctx) return false;
    if (this.ctx.state === 'running') return true;
    try {
      // Avoid hanging indefinitely when called outside a user gesture in Chrome,
      // but allow real user gestures ample time to wake hardware drivers.
      const timeoutMs = fromGesture ? 1500 : 200;
      await Promise.race([
        this.ctx.resume(),
        new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
      ]);
    } catch {
      // ignore if blocked prior to user gesture
    }
    return this.getContextState() === 'running';
  }

  public async rebuildSampleRate(
    sampleRate: 44100 | 48000 | 88200 | 96000,
    channels: ChannelState[],
    bufferSize?: number
  ): Promise<{ baseLatencyMs: number; outputLatencyMs: number }> {
    if (bufferSize !== undefined) {
      this.currentBufferSize = bufferSize;
    }
    this.stopScheduler();
    for (const chId of Array.from(this.channelFileSources.keys())) {
      this.stopFileForChannel(chId);
    }
    for (const nodes of this.channelNodes.values()) {
      this.cleanupDirectSink(nodes);
      for (const osc of nodes.harmonyLfoOscs) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // ignore
        }
      }
      nodes.harmonyLfoOscs = [];
      if (nodes.micSource) {
        try {
          nodes.micSource.disconnect();
        } catch {
          // ignore
        }
        nodes.micSource = undefined;
      }
      if (nodes.micStream) {
        nodes.micStream.getTracks().forEach((t) => t.stop());
        nodes.micStream = undefined;
      }
      nodes.micDeviceId = undefined;
    }
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.channelNodes.clear();
      this.masterOutputGain = null;
      this.appliedSinkId = '';
    }
    const ctx = await this.ensureContext(sampleRate, this.currentBufferSize);
    await this.resumeIfNeeded(true);
    this.rebuildGraph(channels);
    await this.setOutputDevice(this.currentOutputDeviceId);
    const baseMs = Number(((ctx.baseLatency ?? 0.005) * 1000).toFixed(2));
    const outMs = Number((((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0.008) * 1000).toFixed(2));
    return { baseLatencyMs: baseMs, outputLatencyMs: outMs };
  }

  public isSinkIdSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    return typeof (AudioCtx.prototype as AudioContext & { setSinkId?: unknown }).setSinkId === 'function';
  }

  public isMasterOutputEnabled(): boolean {
    return this.masterOutputEnabled;
  }

  public getLastOutputError(): string | null {
    return this.lastOutputError;
  }

  public getLastAppCaptureError(): string | null {
    return this.lastAppCaptureError;
  }

  public setMasterOutputEnabled(enabled: boolean): void {
    this.masterOutputEnabled = enabled;
    if (this.ctx && this.masterOutputGain) {
      const mainBus = this.channelsSnapshot.find((c) => c.id === 'main-bus');
      const mainMutedByOut = mainBus?.outputTargetType === 'none';
      this.masterOutputGain.gain.setTargetAtTime(enabled && !mainMutedByOut ? 1 : 0, this.ctx.currentTime, 0.008);
    }
  }

  private cleanupDirectSink(nodes: ChannelNodes): void {
    if (nodes.directSinkAudio) {
      try {
        nodes.directSinkAudio.pause();
        nodes.directSinkAudio.srcObject = null;
      } catch {
        // ignore
      }
      nodes.directSinkAudio = undefined;
    }
    if (nodes.directSinkDest) {
      try {
        nodes.directSinkDest.disconnect();
      } catch {
        // ignore
      }
      nodes.directSinkDest = undefined;
    }
    nodes.directSinkDeviceId = undefined;
  }

  private wouldCreateOutputCycle(sourceId: string, targetBusId: string, channels: ChannelState[]): boolean {
    const visited = new Set<string>([sourceId]);
    let cursor: string | undefined = targetBusId;
    while (cursor) {
      if (visited.has(cursor)) return true;
      visited.add(cursor);
      const ch = channels.find((c) => c.id === cursor);
      if (!ch) break;
      const outType = ch.outputTargetType ?? (ch.type === 'listen' ? 'hardware' : ch.type === 'master' ? 'hardware' : 'master');
      if (outType !== 'bus') break;
      cursor = ch.outputTargetId;
    }
    return false;
  }

  private routeChannelToHardwareSink(nodes: ChannelNodes, rawDeviceId?: string): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const normalized =
      !rawDeviceId || rawDeviceId === 'default' || rawDeviceId.startsWith('default-')
        ? 'default'
        : rawDeviceId;

    const fallbackDest: AudioNode = this.masterOutputGain ?? ctx.destination;
    if (normalized === 'default' || normalized === this.currentOutputDeviceId) {
      this.cleanupDirectSink(nodes);
      nodes.outputRouterGain.connect(fallbackDest);
      return;
    }

    if (nodes.directSinkDest && nodes.directSinkAudio && nodes.directSinkDeviceId === normalized) {
      nodes.outputRouterGain.connect(nodes.directSinkDest);
      return;
    }

    this.cleanupDirectSink(nodes);
    try {
      const streamDest = ctx.createMediaStreamDestination();
      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioEl.srcObject = streamDest.stream;
      const elWithSink = audioEl as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof elWithSink.setSinkId === 'function') {
        void elWithSink
          .setSinkId(normalized)
          .then(() => audioEl.play().catch(() => {}))
          .catch(() => {
            this.lastOutputError =
              'Browser memblokir perpindahan output non-default di tab/iframe ini. Output memakai default sistem.';
            this.cleanupDirectSink(nodes);
            try {
              nodes.outputRouterGain.disconnect();
              nodes.outputRouterGain.connect(fallbackDest);
            } catch {
              // ignore
            }
          });
      } else {
        this.cleanupDirectSink(nodes);
        nodes.outputRouterGain.connect(fallbackDest);
        return;
      }
      nodes.directSinkDest = streamDest;
      nodes.directSinkAudio = audioEl;
      nodes.directSinkDeviceId = normalized;
      nodes.outputRouterGain.connect(streamDest);
    } catch {
      this.cleanupDirectSink(nodes);
      nodes.outputRouterGain.connect(fallbackDest);
    }
  }

  public async selectAudioOutputDevice(): Promise<AudioDeviceInfo | null> {
    const md = navigator.mediaDevices as MediaDevices & {
      selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
    };
    if (!md?.selectAudioOutput) return null;
    try {
      const picked = await md.selectAudioOutput();
      return {
        deviceId: picked.deviceId,
        label: picked.label || 'Selected Audio Output',
        kind: 'audiooutput',
        groupId: picked.groupId,
      };
    } catch {
      return null;
    }
  }

  public async setOutputDevice(deviceId: string): Promise<boolean> {
    const normalized =
      !deviceId || deviceId === 'default' || deviceId.startsWith('default-')
        ? 'default'
        : deviceId;
    this.currentOutputDeviceId = normalized;
    this.lastOutputError = null;
    if (!this.ctx) return true;

    const sinkId = normalized === 'default' ? '' : normalized;
    if (sinkId === this.appliedSinkId) {
      return true;
    }

    const ctxWithSink = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof ctxWithSink.setSinkId === 'function') {
      try {
        await ctxWithSink.setSinkId(sinkId);
        this.appliedSinkId = sinkId;
        return true;
      } catch (err) {
        const errName = err instanceof Error ? err.name : '';
        if (errName === 'NotAllowedError') {
          this.lastOutputError =
            'Browser memblokir perpindahan output non-default di tab/iframe ini. Atur Earphone sebagai output default Windows/HP atau buka di tab penuh.';
        } else if (errName === 'NotFoundError') {
          this.lastOutputError =
            'Perangkat output yang dipilih tidak ditemukan. Klik Reset Device / Scan Hardware I/O.';
        } else {
          this.lastOutputError =
            'Gagal memindahkan output ke perangkat terpilih; memakai output default sistem.';
        }
        // Fallback to system default if previously saved hardware device was unplugged or blocked
        if (sinkId !== '') {
          try {
            await ctxWithSink.setSinkId('');
            this.currentOutputDeviceId = 'default';
            this.appliedSinkId = '';
          } catch {
            // ignore
          }
        }
        return false;
      }
    }
    if (sinkId !== '') {
      this.lastOutputError =
        'Browser ini tidak mendukung pemilihan output terpisah (setSinkId); memakai output default OS.';
    }
    return false;
  }

  public async enumerateHardwareDevices(requestPermission = false): Promise<AudioDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    if (requestPermission && navigator.mediaDevices.getUserMedia) {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        tempStream.getTracks().forEach((t) => t.stop());
      } catch {
        // User denied or no mic connected; continue enumerating available info
      }
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    let inIdx = 1;
    let outIdx = 1;
    const result: AudioDeviceInfo[] = [];
    for (const d of devices) {
      if (d.kind !== 'audioinput' && d.kind !== 'audiooutput') continue;
      if (d.deviceId === 'communications') continue;
      let label = d.label?.trim();
      if (!label) {
        if (d.deviceId === 'default') {
          label = d.kind === 'audioinput' ? 'Default Audio Input' : 'Default Audio Output';
        } else {
          label = d.kind === 'audioinput' ? `Audio Input ${inIdx++}` : `Audio Output ${outIdx++}`;
        }
      }
      result.push({
        deviceId: d.deviceId,
        label,
        kind: d.kind,
        groupId: d.groupId,
      });
    }
    return result;
  }

  public connectAsioBridge(
    url: string,
    onStatus: (connected: boolean, statusText: string, deviceName?: string) => void
  ): void {
    if (this.asioSocket) {
      this.asioSocket.close();
      this.asioSocket = null;
    }
    try {
      const ws = new WebSocket(url);
      const timeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          onStatus(false, 'ASIO Bridge not running locally · Using Interactive WebAudio');
        }
      }, 1500);

      ws.onopen = () => {
        window.clearTimeout(timeout);
        ws.send(JSON.stringify({ type: 'HELLO_ASIO_CLIENT', version: '1.0' }));
        onStatus(true, 'Connected to Local ASIO Bridge', 'ASIO4ALL / Hardware ASIO Bridge');
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.deviceName) {
            onStatus(true, `ASIO Active · ${msg.bufferSize ?? 128} smp`, msg.deviceName);
          }
        } catch {
          // ignore malformed bridge message
        }
      };

      ws.onerror = () => {
        window.clearTimeout(timeout);
        onStatus(false, 'ASIO Bridge offline · Using Interactive Low-Latency WebAudio');
      };

      ws.onclose = () => {
        window.clearTimeout(timeout);
        if (this.asioSocket === ws) {
          this.asioSocket = null;
        }
      };

      this.asioSocket = ws;
    } catch {
      onStatus(false, 'Invalid Bridge URL · Using Interactive Low-Latency WebAudio');
    }
  }

  private ensureChannelReverbBranch(ctx: AudioContext, nodes: ChannelNodes, shouldWire: boolean): void {
    if (shouldWire === Boolean(nodes.reverbBranchWired)) return;
    if (shouldWire) {
      if (!nodes.revPreDelay) {
        nodes.revPreDelay = ctx.createDelay(0.5);
        nodes.revPreDelay.delayTime.value = 0.07;
      }
      if (!nodes.fxConvolver) {
        nodes.fxConvolver = ctx.createConvolver();
        nodes.fxConvolver.buffer = createImpulseResponse(ctx, 2.4, 2.3, 4200);
      }
      if (!nodes.revWetGain) {
        nodes.revWetGain = ctx.createGain();
        nodes.revWetGain.gain.value = 0;
      }
      nodes.compressor.connect(nodes.revPreDelay);
      nodes.revPreDelay.connect(nodes.fxConvolver);
      nodes.fxConvolver.connect(nodes.revWetGain);
      nodes.revWetGain.connect(nodes.panner);
      nodes.reverbBranchWired = true;
    } else {
      try {
        nodes.compressor.disconnect(nodes.revPreDelay!);
        nodes.revWetGain?.disconnect(nodes.panner);
      } catch {
        // ignore if already disconnected
      }
      nodes.reverbBranchWired = false;
    }
  }

  private ensureChannelDelayBranch(ctx: AudioContext, nodes: ChannelNodes, shouldWire: boolean): void {
    if (shouldWire === Boolean(nodes.delayBranchWired)) return;
    if (shouldWire) {
      if (!nodes.delayWetGain) {
        nodes.delayWetGain = ctx.createGain();
        nodes.delayWetGain.gain.value = 0;
      }
      if (!nodes.fxDelay) {
        nodes.fxDelay = ctx.createDelay(2.0);
        nodes.fxDelay.delayTime.value = 0.5;
      }
      if (!nodes.fxFeedback) {
        nodes.fxFeedback = ctx.createGain();
        nodes.fxFeedback.gain.value = 0.17;
      }
      if (!nodes.fxTone) {
        nodes.fxTone = ctx.createBiquadFilter();
        nodes.fxTone.type = 'lowpass';
        nodes.fxTone.frequency.value = 4470;
      }
      nodes.compressor.connect(nodes.fxDelay);
      nodes.fxDelay.connect(nodes.fxTone);
      nodes.fxTone.connect(nodes.fxFeedback);
      nodes.fxFeedback.connect(nodes.fxDelay);
      nodes.fxTone.connect(nodes.delayWetGain);
      nodes.delayWetGain.connect(nodes.panner);
      nodes.delayBranchWired = true;
    } else {
      try {
        nodes.compressor.disconnect(nodes.fxDelay!);
        nodes.delayWetGain?.disconnect(nodes.panner);
      } catch {
        // ignore
      }
      nodes.delayBranchWired = false;
    }
  }

  private ensureChannelHarmonyBranch(ctx: AudioContext, nodes: ChannelNodes, shouldWire: boolean): void {
    if (shouldWire === Boolean(nodes.harmonyBranchWired)) return;
    if (shouldWire) {
      if (!nodes.harmonyWetGain) {
        nodes.harmonyWetGain = ctx.createGain();
        nodes.harmonyWetGain.gain.value = 0;
      }
      if (nodes.harmonyVoiceGains.length === 0) {
        const voiceTimes = [0.009, 0.015, 0.021, 0.027];
        const voicePans = [-0.35, 0.35, -0.65, 0.65];
        const voiceLfoHz = [1.1, 1.5, 0.85, 1.85];
        voiceTimes.forEach((dt, idx) => {
          const vDelay = ctx.createDelay(0.1);
          vDelay.delayTime.value = dt;
          const lfo = ctx.createOscillator();
          lfo.frequency.value = voiceLfoHz[idx];
          const lfoDepth = ctx.createGain();
          lfoDepth.gain.value = 0.0014;
          lfo.connect(lfoDepth);
          lfoDepth.connect(vDelay.delayTime);
          lfo.start();

          const vPan = ctx.createStereoPanner();
          vPan.pan.value = voicePans[idx];
          const vGain = ctx.createGain();
          vGain.gain.value = 0;

          nodes.compressor.connect(vDelay);
          vDelay.connect(vGain);
          vGain.connect(vPan);
          vPan.connect(nodes.harmonyWetGain!);
          nodes.harmonyVoiceGains.push(vGain);
          nodes.harmonyLfoOscs.push(lfo);
        });
      }
      nodes.harmonyWetGain.connect(nodes.panner);
      nodes.harmonyBranchWired = true;
    } else {
      try {
        nodes.harmonyWetGain?.disconnect(nodes.panner);
      } catch {
        // ignore
      }
      nodes.harmonyBranchWired = false;
    }
  }

  public rebuildGraph(channels: ChannelState[]): void {
    this.channelsSnapshot = channels;
    if (!this.ctx) return;
    const ctx = this.ctx;

    // Create nodes for any channel not yet created
    for (const ch of channels) {
      if (!this.channelNodes.has(ch.id)) {
        const inputGain = ctx.createGain();
        const lowFilter = ctx.createBiquadFilter();
        lowFilter.type = 'lowshelf';
        lowFilter.frequency.value = 120;

        const midFilter = ctx.createBiquadFilter();
        midFilter.type = 'peaking';
        midFilter.frequency.value = 1200;
        midFilter.Q.value = 1.0;

        const highFilter = ctx.createBiquadFilter();
        highFilter.type = 'highshelf';
        highFilter.frequency.value = 6000;

        const megaphoneFilter = ctx.createBiquadFilter();
        megaphoneFilter.type = 'peaking';
        megaphoneFilter.frequency.value = 1450;
        megaphoneFilter.Q.value = 1.0;
        megaphoneFilter.gain.value = 0;

        const compressor = ctx.createDynamicsCompressor();
        const revDryGain = ctx.createGain();
        revDryGain.gain.value = 1;

        const panner = ctx.createStereoPanner();
        const faderGain = ctx.createGain();
        const splitter = ctx.createChannelSplitter(2);
        const analyserL = ctx.createAnalyser();
        analyserL.fftSize = ch.type === 'master' ? 2048 : 512;
        analyserL.smoothingTimeConstant = 0.72;
        const analyserR = ctx.createAnalyser();
        analyserR.fftSize = ch.type === 'master' ? 2048 : 512;
        analyserR.smoothingTimeConstant = 0.72;
        const outputRouterGain = ctx.createGain();

        const nodes: ChannelNodes = {
          inputGain,
          lowFilter,
          midFilter,
          highFilter,
          megaphoneFilter,
          compressor,
          revDryGain,
          harmonyVoiceGains: [],
          harmonyLfoOscs: [],
          panner,
          faderGain,
          splitter,
          analyserL,
          analyserR,
          outputRouterGain,
          sendGains: new Map(),
        };

        // FX Bus DSP
        if (ch.type === 'fx') {
          const isReverb = ch.inserts.some((i) => i.type === 'reverb');
          const isDelay = ch.inserts.some((i) => i.type === 'delay' || i.type === 'harmony');

          if (isReverb) {
            const revPlugin = ch.inserts.find((i) => i.type === 'reverb');
            const decay = revPlugin?.params.decay ?? 2.5;
            const fxConvolver = ctx.createConvolver();
            fxConvolver.buffer = createImpulseResponse(ctx, Math.min(5, decay), 2.4, 3600);
            nodes.fxConvolver = fxConvolver;
            inputGain.connect(fxConvolver);
            fxConvolver.connect(lowFilter);
          } else if (isDelay) {
            const delPlugin = ch.inserts.find((i) => i.type === 'delay');
            const chDelay = ctx.createDelay(2.0);
            chDelay.delayTime.value = (delPlugin?.params.timeMs ?? 320) / 1000;
            const chDelayFeedback = ctx.createGain();
            chDelayFeedback.gain.value = Math.min(0.85, (delPlugin?.params.feedback ?? 35) / 100);
            const chDelayTone = ctx.createBiquadFilter();
            chDelayTone.type = 'lowpass';
            chDelayTone.frequency.value = delPlugin?.params.tone ?? 3200;
            nodes.fxDelay = chDelay;
            nodes.fxFeedback = chDelayFeedback;
            nodes.fxTone = chDelayTone;

            inputGain.connect(chDelay);
            chDelay.connect(chDelayTone);
            chDelayTone.connect(chDelayFeedback);
            chDelayFeedback.connect(chDelay);
            chDelayTone.connect(lowFilter);
          } else {
            inputGain.connect(lowFilter);
          }
        } else {
          inputGain.connect(lowFilter);
        }

        lowFilter.connect(midFilter);
        midFilter.connect(highFilter);
        highFilter.connect(megaphoneFilter);
        megaphoneFilter.connect(compressor);

        // Main dry path
        compressor.connect(revDryGain);
        revDryGain.connect(panner);

        panner.connect(faderGain);

        faderGain.connect(splitter);
        splitter.connect(analyserL, 0);
        splitter.connect(analyserR, 1);
        faderGain.connect(outputRouterGain);

        // Master metering FFT & hardware destination gate
        if (ch.type === 'master') {
          this.fftBuf = new Uint8Array(analyserL.frequencyBinCount);
          this.recordDest = ctx.createMediaStreamDestination();
          this.masterOutputGain = ctx.createGain();
          const masterEnabled = this.masterOutputEnabled && ch.outputTargetType !== 'none';
          this.masterOutputGain.gain.value = masterEnabled ? 1 : 0;
          outputRouterGain.connect(this.masterOutputGain);
          this.masterOutputGain.connect(ctx.destination);
          faderGain.connect(this.recordDest);
        }

        this.channelNodes.set(ch.id, nodes);
      }

      // Lazily attach/detach heavy parallel FX branches only when enabled on non-fx strips
      const nodes = this.channelNodes.get(ch.id);
      if (nodes && ch.type !== 'fx') {
        const needsReverb = ch.inserts.some((i) => i.type === 'reverb' && i.enabled);
        const needsDelay = ch.inserts.some((i) => i.type === 'delay' && i.enabled);
        const needsHarmony = ch.inserts.some((i) => i.type === 'harmony' && i.enabled);
        this.ensureChannelReverbBranch(ctx, nodes, needsReverb);
        this.ensureChannelDelayBranch(ctx, nodes, needsDelay);
        this.ensureChannelHarmonyBranch(ctx, nodes, needsHarmony);
      }
    }

    // Lazily create internal FX Send buses only if any channel send actually targets them
    const referencedBusIds = new Set<string>();
    for (const ch of channels) {
      for (const s of ch.sends) {
        if (s.enabled) referencedBusIds.add(s.targetBusId);
      }
    }

    const internalFxDefs = [
      { id: 'fx-reverb-internal', mode: 'reverb', decay: 2.4 },
      { id: 'fx-hall-internal', mode: 'reverb', decay: 4.0 },
      { id: 'fx-delay-internal', mode: 'delay', timeMs: 360 },
    ] as const;

    const masterNode = this.channelNodes.get('main-bus');
    if (masterNode) {
      for (const fxDef of internalFxDefs) {
        if (referencedBusIds.has(fxDef.id) && !this.channelNodes.has(fxDef.id)) {
          const inputGain = ctx.createGain();
          const lowFilter = ctx.createBiquadFilter();
          lowFilter.type = 'highpass';
          lowFilter.frequency.value = 160;
          const midFilter = ctx.createBiquadFilter();
          const highFilter = ctx.createBiquadFilter();
          const megaphoneFilter = ctx.createBiquadFilter();
          megaphoneFilter.type = 'peaking';
          megaphoneFilter.gain.value = 0;
          const compressor = ctx.createDynamicsCompressor();
          const revDryGain = ctx.createGain();
          const panner = ctx.createStereoPanner();
          const faderGain = ctx.createGain();
          faderGain.gain.value = 0.7;
          const splitter = ctx.createChannelSplitter(2);
          const analyserL = ctx.createAnalyser();
          analyserL.fftSize = 512;
          const analyserR = ctx.createAnalyser();
          analyserR.fftSize = 512;
          const outputRouterGain = ctx.createGain();

          if (fxDef.mode === 'reverb') {
            const conv = ctx.createConvolver();
            conv.buffer = createImpulseResponse(ctx, fxDef.decay, 2.4, 3400);
            inputGain.connect(conv);
            conv.connect(lowFilter);
          } else {
            const delay = ctx.createDelay(2.0);
            delay.delayTime.value = fxDef.timeMs / 1000;
            const fb = ctx.createGain();
            fb.gain.value = 0.36;
            inputGain.connect(delay);
            delay.connect(fb);
            fb.connect(delay);
            delay.connect(lowFilter);
          }
          lowFilter.connect(faderGain);
          faderGain.connect(masterNode.inputGain);

          this.channelNodes.set(fxDef.id, {
            inputGain,
            lowFilter,
            midFilter,
            highFilter,
            megaphoneFilter,
            compressor,
            revDryGain,
            harmonyVoiceGains: [],
            harmonyLfoOscs: [],
            panner,
            faderGain,
            splitter,
            analyserL,
            analyserR,
            outputRouterGain,
            sendGains: new Map(),
          });
        }
      }

      for (const ch of channels) {
        const nodes = this.channelNodes.get(ch.id);
        if (!nodes) continue;
        if (ch.type === 'master') {
          if (this.masterOutputGain) {
            const masterEnabled = this.masterOutputEnabled && ch.outputTargetType !== 'none';
            this.masterOutputGain.gain.setTargetAtTime(masterEnabled ? 1 : 0, ctx.currentTime, 0.008);
          }
        } else if (ch.type === 'audio' || ch.type === 'fx' || ch.type === 'listen') {
          const outType = ch.outputTargetType ?? (ch.type === 'listen' ? 'hardware' : 'master');
          const outId = ch.outputTargetId ?? (ch.type === 'listen' ? 'default' : 'main-bus');
          const nextRouteKey = `${outType}:${outId}`;

          // Avoid disconnecting active audio nodes on unrelated fader/pan/DSP updates!
          if (nodes.outRouteKey !== nextRouteKey) {
            try {
              nodes.outputRouterGain.disconnect();
            } catch {
              // not yet connected
            }

            if (outType === 'none') {
              this.cleanupDirectSink(nodes);
            } else if (outType === 'hardware') {
              this.routeChannelToHardwareSink(nodes, outId);
            } else if (outType === 'bus') {
              this.cleanupDirectSink(nodes);
              const targetBus = this.channelNodes.get(outId);
              if (
                targetBus &&
                outId !== ch.id &&
                !this.wouldCreateOutputCycle(ch.id, outId, channels)
              ) {
                nodes.outputRouterGain.connect(targetBus.inputGain);
              } else if (ch.type === 'listen') {
                nodes.outputRouterGain.connect(this.masterOutputGain ?? ctx.destination);
              } else {
                nodes.outputRouterGain.connect(masterNode.inputGain);
              }
            } else {
              this.cleanupDirectSink(nodes);
              if (ch.type === 'listen') {
                nodes.outputRouterGain.connect(this.masterOutputGain ?? ctx.destination);
              } else {
                nodes.outputRouterGain.connect(masterNode.inputGain);
              }
            }
            nodes.outRouteKey = nextRouteKey;
          }
        }

        // Clean up removed sends & wire active Sends
        const activeSendIds = new Set(ch.sends.map((s) => s.id));
        for (const [sid, sg] of nodes.sendGains.entries()) {
          if (!activeSendIds.has(sid)) {
            try {
              sg.disconnect();
            } catch {
              // ignore
            }
            nodes.sendGains.delete(sid);
          }
        }
        for (const send of ch.sends) {
          const targetBus = this.channelNodes.get(send.targetBusId);
          if (!targetBus) continue;
          let sg = nodes.sendGains.get(send.id);
          if (!sg) {
            sg = ctx.createGain();
            nodes.sendGains.set(send.id, sg);
            nodes.faderGain.connect(sg);
            sg.connect(targetBus.inputGain);
          }
          sg.gain.setTargetAtTime(send.enabled ? dbToLinear(send.levelDb) : 0, ctx.currentTime, 0.005);
        }
      }
    }

    this.syncParameters(channels);
  }

  public syncParameters(channels: ChannelState[]): void {
    this.channelsSnapshot = channels;
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const anySolo = channels.some((c) => c.solo && c.type !== 'master' && c.type !== 'listen');

    for (const ch of channels) {
      const nodes = this.channelNodes.get(ch.id);
      if (!nodes) continue;

      // Polarity & Input Gain (+ Wider / Limiter / Compressor makeup gain)
      const polaritySign = !ch.polarityLeft && ch.polarityRight ? -1 : 1;
      const widerIns = ch.inserts.find((i) => i.type === 'wider' && i.enabled);
      const limiterIns = ch.inserts.find((i) => i.type === 'limiter' && i.enabled);
      const compIns = ch.inserts.find((i) => i.type === 'compressor' && i.enabled);
      const extraGainDb =
        (widerIns?.params.gain ?? 0) +
        (limiterIns?.params.gain ?? 0) +
        (compIns?.params.makeup ?? 0);
      nodes.inputGain.gain.setTargetAtTime(dbToLinear(ch.inputGainDb + extraGainDb) * polaritySign, now, 0.015);

      // Live mic mono/stereo input routing matrix
      if (nodes.micGainLL && nodes.micGainLR && nodes.micGainRL && nodes.micGainRR) {
        const micMode = ch.micChannelMode ?? 'mono-lr';
        let ll = 0.65;
        let lr = 0.65;
        let rl = 0.65;
        let rr = 0.65;
        if (micMode === 'left') {
          ll = 1;
          lr = 1;
          rl = 0;
          rr = 0;
        } else if (micMode === 'right') {
          ll = 0;
          lr = 0;
          rl = 1;
          rr = 1;
        } else if (micMode === 'stereo') {
          ll = 1;
          lr = 0;
          rl = 0;
          rr = 1;
        }
        nodes.micGainLL.gain.setTargetAtTime(ll, now, 0.008);
        nodes.micGainLR.gain.setTargetAtTime(lr, now, 0.008);
        nodes.micGainRL.gain.setTargetAtTime(rl, now, 0.008);
        nodes.micGainRR.gain.setTargetAtTime(rr, now, 0.008);
      }

      // EQ inserts
      const eqInsert = ch.inserts.find((i) => (i.type === 'pro-q' || i.type === 'pro-eq') && i.enabled);
      if (eqInsert) {
        nodes.lowFilter.gain.setTargetAtTime(eqInsert.params.lowGain ?? 0, now, 0.02);
        nodes.midFilter.frequency.setTargetAtTime(eqInsert.params.midFreq ?? 1200, now, 0.02);
        nodes.midFilter.gain.setTargetAtTime(eqInsert.params.midGain ?? 0, now, 0.02);
        nodes.highFilter.gain.setTargetAtTime(eqInsert.params.highGain ?? 0, now, 0.02);
      } else {
        nodes.lowFilter.gain.setTargetAtTime(0, now, 0.02);
        nodes.midFilter.gain.setTargetAtTime(0, now, 0.02);
        nodes.highFilter.gain.setTargetAtTime(0, now, 0.02);
      }

      // Megaphone bandpass insert (unity peaking 0dB when bypassed to avoid phase shift / filter reset clicks)
      const mega = ch.inserts.find((i) => i.type === 'megaphone' && i.enabled);
      if (mega) {
        if (nodes.megaphoneFilter.type !== 'bandpass') {
          nodes.megaphoneFilter.type = 'bandpass';
        }
        nodes.megaphoneFilter.frequency.setTargetAtTime(mega.params.focusHz ?? 1450, now, 0.02);
        nodes.megaphoneFilter.Q.setTargetAtTime(mega.params.q ?? 2.4, now, 0.02);
      } else {
        if (nodes.megaphoneFilter.type !== 'peaking') {
          nodes.megaphoneFilter.type = 'peaking';
        }
        nodes.megaphoneFilter.gain.setTargetAtTime(0, now, 0.02);
        nodes.megaphoneFilter.Q.setTargetAtTime(1.0, now, 0.02);
      }

      // Compressor / Limiter / Multiband
      const comp = ch.inserts.find(
        (i) => (i.type === 'compressor' || i.type === 'limiter' || i.type === 'multiband') && i.enabled
      );
      if (comp) {
        const thresh =
          comp.type === 'limiter'
            ? Math.min(comp.params.threshold ?? -3, comp.params.ceiling ?? -0.3)
            : comp.params.threshold ?? -18;
        nodes.compressor.threshold.setTargetAtTime(Math.max(-60, Math.min(0, thresh)), now, 0.02);
        nodes.compressor.ratio.setTargetAtTime(comp.type === 'limiter' ? 20 : comp.params.ratio ?? 4, now, 0.02);
        nodes.compressor.knee.setTargetAtTime(
          comp.type === 'limiter' ? 0 : Math.max(0, Math.min(40, (comp.params.knee ?? 3.8) * 3)),
          now,
          0.02
        );
        const attackMs =
          comp.type === 'limiter'
            ? comp.params.attackMode === 0
              ? 1
              : comp.params.attackMode === 2
              ? 12
              : 4
            : comp.params.attack ?? 12;
        nodes.compressor.attack.setTargetAtTime(Math.max(0.0002, attackMs / 1000), now, 0.02);
        nodes.compressor.release.setTargetAtTime(Math.max(0.01, (comp.params.release ?? 120) / 1000), now, 0.02);
      } else {
        nodes.compressor.threshold.setTargetAtTime(0, now, 0.02);
        nodes.compressor.ratio.setTargetAtTime(1, now, 0.02);
      }

      // Delay FX / Insert params
      if (nodes.fxDelay && nodes.fxFeedback && nodes.fxTone && nodes.delayWetGain) {
        const del = ch.inserts.find((i) => i.type === 'delay');
        if (del && del.enabled) {
          nodes.fxDelay.delayTime.setTargetAtTime(
            Math.max(0.01, Math.min(1.9, (del.params.timeMs ?? 500) / 1000)),
            now,
            0.01
          );
          nodes.fxFeedback.gain.setTargetAtTime(
            Math.min(0.85, (del.params.feedback ?? 17) / 100),
            now,
            0.01
          );
          nodes.fxTone.frequency.setTargetAtTime(del.params.hiCut ?? del.params.tone ?? 4470, now, 0.01);
          nodes.delayWetGain.gain.setTargetAtTime(
            Math.max(0, Math.min(1, (del.params.mix ?? 100) / 100)) * 0.75,
            now,
            0.008
          );
        } else {
          nodes.fxFeedback.gain.setTargetAtTime(0, now, 0.01);
          nodes.delayWetGain.gain.setTargetAtTime(0, now, 0.008);
        }
      }

      // Reverb Insert wet/dry & pre-delay
      const revIns = ch.inserts.find((i) => i.type === 'reverb' && i.enabled);
      if (revIns && ch.type !== 'fx' && nodes.revPreDelay && nodes.revWetGain) {
        const mixNorm = Math.max(0, Math.min(1, (revIns.params.mix ?? 100) / 100));
        const preDelaySec = Math.max(0, Math.min(0.45, (revIns.params.preDelay ?? 70) / 1000));
        nodes.revPreDelay.delayTime.setTargetAtTime(preDelaySec, now, 0.006);
        nodes.revDryGain.gain.setTargetAtTime(1 - mixNorm * 0.65, now, 0.006);
        nodes.revWetGain.gain.setTargetAtTime(mixNorm * 0.9, now, 0.006);
      } else {
        nodes.revDryGain.gain.setTargetAtTime(1, now, 0.006);
        if (nodes.revWetGain) {
          nodes.revWetGain.gain.setTargetAtTime(0, now, 0.006);
        }
      }

      // Harmony 1/2/3/4 Voice Insert DSP
      const harmIns = ch.inserts.find((i) => i.type === 'harmony' && i.enabled);
      if (nodes.harmonyWetGain) {
        if (harmIns && nodes.harmonyVoiceGains.length === 4) {
          const vCount = Math.max(1, Math.min(4, Math.round(harmIns.params.voiceCount ?? 2)));
          const hMix = Math.max(0, Math.min(1, (harmIns.params.mix ?? 75) / 100));
          nodes.harmonyWetGain.gain.setTargetAtTime(hMix * 0.75, now, 0.008);
          nodes.harmonyVoiceGains.forEach((vg, idx) => {
            const lvlDb = harmIns.params[`v${idx}_level`] ?? -3;
            vg.gain.setTargetAtTime(idx < vCount ? dbToLinear(lvlDb) * 0.55 : 0, now, 0.008);
          });
        } else {
          nodes.harmonyWetGain.gain.setTargetAtTime(0, now, 0.008);
        }
      }

      // Pan (-100..100 -> -1..1) with ultra-low-latency smoothing
      nodes.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, ch.pan / 100)), now, 0.004);

      // Mute / Solo / Fader
      let muted = ch.mute;
      if (ch.type === 'audio' && anySolo && !ch.solo) {
        muted = true;
      }
      const targetGain = muted ? 0 : dbToLinear(ch.faderDb);
      nodes.faderGain.gain.setTargetAtTime(targetGain, now, 0.004);

      // Sends
      for (const send of ch.sends) {
        const sg = nodes.sendGains.get(send.id);
        if (sg) {
          sg.gain.setTargetAtTime(send.enabled && !muted ? dbToLinear(send.levelDb) : 0, now, 0.005);
        }
      }
    }
  }

  public async enableLiveMicInput(channelId: string, deviceId?: string, enable = true): Promise<boolean> {
    const ctx = await this.ensureContext();
    await this.resumeIfNeeded(true);
    if (!this.channelNodes.has(channelId) && this.channelsSnapshot.length > 0) {
      this.rebuildGraph(this.channelsSnapshot);
    }
    const nodes = this.channelNodes.get(channelId);
    if (!nodes) return false;

    if (!enable) {
      if (nodes.micSource) {
        nodes.micSource.disconnect();
        nodes.micSource = undefined;
      }
      if (nodes.micStream) {
        nodes.micStream.getTracks().forEach((t) => t.stop());
        nodes.micStream = undefined;
      }
      nodes.micDeviceId = undefined;
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) return false;

    const normalizedId =
      deviceId && deviceId !== 'default' && !deviceId.startsWith('default-')
        ? deviceId
        : undefined;
    const targetKey = normalizedId ?? 'default';

    // Already streaming live from the exact requested device
    if (
      nodes.micStream &&
      nodes.micDeviceId === targetKey &&
      nodes.micStream.getAudioTracks().some((t) => t.readyState === 'live')
    ) {
      nodes.micStream.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
      await this.resumeIfNeeded(true);
      this.syncParameters(this.channelsSnapshot);
      return true;
    }

    const attempts: MediaStreamConstraints[] = [];
    if (normalizedId) {
      attempts.push({
        audio: {
          deviceId: { exact: normalizedId },
          sampleRate: { ideal: ctx.sampleRate },
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      attempts.push({
        audio: {
          deviceId: { ideal: normalizedId },
          sampleRate: { ideal: ctx.sampleRate },
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    }
    attempts.push({
      audio: {
        sampleRate: { ideal: ctx.sampleRate },
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    attempts.push({ audio: true });

    let stream: MediaStream | null = null;
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream && stream.getAudioTracks().length > 0) {
          break;
        }
      } catch {
        stream = null;
      }
    }

    if (!stream) return false;

    try {
      if (nodes.micSource) nodes.micSource.disconnect();
      if (nodes.micStream) nodes.micStream.getTracks().forEach((t) => t.stop());

      stream.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
      if (
        !nodes.micSplitter ||
        !nodes.micMerger ||
        !nodes.micGainLL ||
        !nodes.micGainLR ||
        !nodes.micGainRL ||
        !nodes.micGainRR
      ) {
        nodes.micSplitter = ctx.createChannelSplitter(2);
        nodes.micMerger = ctx.createChannelMerger(2);
        nodes.micGainLL = ctx.createGain();
        nodes.micGainLR = ctx.createGain();
        nodes.micGainRL = ctx.createGain();
        nodes.micGainRR = ctx.createGain();

        nodes.micSplitter.connect(nodes.micGainLL, 0);
        nodes.micSplitter.connect(nodes.micGainLR, 0);
        nodes.micSplitter.connect(nodes.micGainRL, 1);
        nodes.micSplitter.connect(nodes.micGainRR, 1);

        nodes.micGainLL.connect(nodes.micMerger, 0, 0);
        nodes.micGainRL.connect(nodes.micMerger, 0, 0);
        nodes.micGainLR.connect(nodes.micMerger, 0, 1);
        nodes.micGainRR.connect(nodes.micMerger, 0, 1);

        nodes.micMerger.connect(nodes.inputGain);
      }

      const src = ctx.createMediaStreamSource(stream);
      src.connect(nodes.micSplitter);
      nodes.micSource = src;
      nodes.micStream = stream;
      nodes.micDeviceId = targetKey;
      await this.resumeIfNeeded(true);
      this.syncParameters(this.channelsSnapshot);
      return true;
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
  }

  public hasActiveLiveStream(channelId: string): boolean {
    const nodes = this.channelNodes.get(channelId);
    if (!nodes?.micStream) return false;
    return nodes.micStream.getAudioTracks().some((t) => t.readyState === 'live');
  }

  public async enableApplicationAudioInput(
    channelId: string,
    onEnded?: () => void
  ): Promise<boolean> {
    const ctx = await this.ensureContext();
    await this.resumeIfNeeded(true);
    if (!this.channelNodes.has(channelId) && this.channelsSnapshot.length > 0) {
      this.rebuildGraph(this.channelsSnapshot);
    }
    const nodes = this.channelNodes.get(channelId);
    this.lastAppCaptureError = null;
    if (!nodes || !navigator.mediaDevices?.getDisplayMedia) {
      this.lastAppCaptureError = 'Browser ini tidak mendukung capture audio aplikasi (getDisplayMedia).';
      return false;
    }

    try {
      const displayConstraints = {
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        suppressLocalAudioPlayback: false,
      } as unknown as DisplayMediaStreamOptions;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
      } catch (firstErr) {
        const msg = firstErr instanceof Error ? firstErr.message.toLowerCase() : '';
        const name = firstErr instanceof Error ? firstErr.name : '';
        if (name === 'NotAllowedError' || name === 'AbortError' || msg.includes('permission') || msg.includes('policy')) {
          throw firstErr;
        }
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      }

      // Stop unused video tracks; keep only audio stream
      stream.getVideoTracks().forEach((vt) => vt.stop());
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        this.lastAppCaptureError =
          'Audio belum ikut terbagikan. Di popup pilih Tab Chrome atau Entire Screen lalu centang "Share audio" / "Share system audio".';
        return false;
      }

      if (nodes.micSource) nodes.micSource.disconnect();
      if (nodes.micStream) nodes.micStream.getTracks().forEach((t) => t.stop());

      audioTracks.forEach((t) => {
        t.enabled = true;
      });
      const src = ctx.createMediaStreamSource(stream);
      src.connect(nodes.inputGain);
      nodes.micSource = src;
      nodes.micStream = stream;

      audioTracks[0].onended = () => {
        if (nodes.micSource === src) {
          try {
            src.disconnect();
          } catch {
            // ignore
          }
          nodes.micSource = undefined;
          nodes.micStream = undefined;
          onEnded?.();
        }
      };

      await this.resumeIfNeeded(true);
      this.syncParameters(this.channelsSnapshot);
      return true;
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      const errMsg = err instanceof Error ? err.message.toLowerCase() : '';
      const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
      if (errMsg.includes('permissions policy') || errMsg.includes('disallowed')) {
        this.lastAppCaptureError =
          'Capture audio aplikasi diblokir oleh pratinjau iframe. Gunakan File Musik, driver ASIO (VC In 1 + 2), atau buka di tab penuh / .EXE.';
      } else if (isFirefox) {
        this.lastAppCaptureError =
          'Firefox tidak mendukung capture audio tab langsung lewat browser. Gunakan Maono VC In 1 + 2 (arahkan output Firefox ke VC 1/2 di Windows Sound) atau Load File Musik.';
      } else if (errName === 'NotAllowedError' || errName === 'AbortError') {
        this.lastAppCaptureError =
          'Capture audio jendela/aplikasi dibatalkan atau tidak didukung (browser tidak bisa menangkap audio jendela Firefox langsung). Gunakan Maono VC In 1 + 2, Entire Screen + Share audio, atau File Musik.';
      } else {
        this.lastAppCaptureError =
          'Audio aplikasi belum terpilih. Pilih Tab Chrome / Entire Screen + "Share audio", atau gunakan VC In 1 + 2.';
      }
      return false;
    }
  }

  public async playFileForChannel(channelId: string, sampleRate = 48000, loop = true): Promise<boolean> {
    const buf = this.customBuffers.get(channelId);
    if (!buf) return false;
    const ctx = await this.ensureContext(sampleRate);
    await this.resumeIfNeeded(true);
    this.rebuildGraph(this.channelsSnapshot);
    const nodes = this.channelNodes.get(channelId);
    if (!nodes) return false;

    this.stopFileForChannel(channelId);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(nodes.inputGain);
    src.onended = () => {
      if (this.channelFileSources.get(channelId) === src) {
        this.channelFileSources.delete(channelId);
      }
    };
    this.channelFileSources.set(channelId, src);
    src.start(ctx.currentTime);
    return true;
  }

  public stopFileForChannel(channelId: string): void {
    const existing = this.channelFileSources.get(channelId);
    if (existing) {
      try {
        existing.stop();
        existing.disconnect();
      } catch {
        // ignore already stopped
      }
      this.channelFileSources.delete(channelId);
    }
  }

  public isFilePlaying(channelId: string): boolean {
    return this.channelFileSources.has(channelId);
  }

  public async loadAudioFileForChannel(channelId: string, file: File): Promise<{ peaks: number[]; duration: number } | null> {
    const ctx = await this.ensureContext();
    await this.resumeIfNeeded(true);
    try {
      const arr = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr);
      this.customBuffers.set(channelId, decoded);

      const raw = decoded.getChannelData(0);
      const bars = 64;
      const blockSize = Math.max(1, Math.floor(raw.length / bars));
      const peaks: number[] = [];
      for (let i = 0; i < bars; i++) {
        let max = 0;
        for (let j = 0; j < blockSize; j += 4) {
          const val = Math.abs(raw[i * blockSize + j] ?? 0);
          if (val > max) max = val;
        }
        peaks.push(Math.min(1, Math.max(0.08, max)));
      }
      return { peaks, duration: decoded.duration };
    } catch {
      return null;
    }
  }

  public async startPlayback(
    transport: TransportState,
    channels: ChannelState[],
    asioConfig: AsioDriverConfig
  ): Promise<void> {
    const ctx = await this.ensureContext(asioConfig.sampleRate);
    await this.resumeIfNeeded(true);
    this.rebuildGraph(channels);
    this.transportSnapshot = transport;
    this.stopScheduler();

    // Launch custom loaded audio files if present (skip if already launched via playFileForChannel)
    for (const ch of channels) {
      const buf = this.customBuffers.get(ch.id);
      const nodes = this.channelNodes.get(ch.id);
      if (buf && nodes && ch.inputSource === 'file' && ch.monitor && !this.channelFileSources.has(ch.id)) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = transport.isLooping;
        src.connect(nodes.inputGain);
        const offset = transport.currentTimeSec % buf.duration;
        src.start(ctx.currentTime, offset);
        this.activeBufferSources.push(src);
      }
    }

    this.nextStepTime = ctx.currentTime + 0.008;
    this.currentStep = Math.floor((transport.currentTimeSec * transport.bpm) / 60 * 4) % 16;

    const scheduleStep = () => {
      if (!this.ctx || !this.transportSnapshot) return;
      const secPer16th = 60 / this.transportSnapshot.bpm / 4;
      while (this.nextStepTime < this.ctx.currentTime + 0.045) {
        this.triggerStepAudio(this.currentStep, this.nextStepTime);
        this.nextStepTime += secPer16th;
        this.currentStep = (this.currentStep + 1) % 16;
      }
    };

    this.schedulerTimer = window.setInterval(scheduleStep, 10);
  }

  public stopPlayback(): void {
    this.stopScheduler();
    for (const s of this.activeBufferSources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        // ignore already stopped
      }
    }
    this.activeBufferSources = [];
  }

  private stopScheduler(): void {
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  private triggerStepAudio(step: number, time: number): void {
    if (!this.ctx || !this.transportSnapshot) return;
    const ctx = this.ctx;

    // Metronome
    if (this.transportSnapshot.metronomeOn && step % 4 === 0) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(step === 0 ? 1320 : 880, time);
      g.gain.setValueAtTime(0.22, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
      osc.connect(g);
      const main = this.channelNodes.get('main-bus');
      g.connect(main ? main.faderGain : ctx.destination);
      osc.start(time);
      osc.stop(time + 0.06);
    }

    // Channel 2: MUSIK (Punchy kick/snare/hihat + warm bass groove)
    const ch2 = this.channelNodes.get('ch-2');
    const ch2State = this.channelsSnapshot.find((c) => c.id === 'ch-2');
    if (ch2 && ch2State?.inputSource === 'demo') {
      if (step % 4 === 0) {
        // Kick
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(130, time);
        osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
        g.gain.setValueAtTime(0.68, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
        osc.connect(g);
        g.connect(ch2.inputGain);
        osc.start(time);
        osc.stop(time + 0.25);
      }
      if (step === 4 || step === 12) {
        // Snare crack
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(210, time);
        osc.frequency.exponentialRampToValueAtTime(95, time + 0.09);
        g.gain.setValueAtTime(0.32, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
        osc.connect(g);
        g.connect(ch2.inputGain);
        osc.start(time);
        osc.stop(time + 0.15);
      }
      if (step % 2 === 0) {
        // Sub Bass Groove
        const notes = [55, 55, 65.41, 73.42, 55, 55, 82.41, 65.41];
        const freq = notes[(step / 2) % notes.length];
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(420, time);
        osc.frequency.setValueAtTime(freq, time);
        g.gain.setValueAtTime(0.24, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
        osc.connect(lp);
        lp.connect(g);
        g.connect(ch2.inputGain);
        osc.start(time);
        osc.stop(time + 0.2);
      }
    }

    // Channel 3: VOCAL (Lead Melody / Formant Synth Voice)
    const ch3 = this.channelNodes.get('ch-3');
    const ch3State = this.channelsSnapshot.find((c) => c.id === 'ch-3');
    if (ch3 && ch3State?.inputSource === 'demo' && (step === 0 || step === 3 || step === 6 || step === 10 || step === 14)) {
      const melody = [440, 523.25, 587.33, 659.25, 523.25];
      const idx = [0, 3, 6, 10, 14].indexOf(step);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(melody[idx] ?? 440, time);
      g.gain.setValueAtTime(0.24, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
      osc.connect(g);
      g.connect(ch3.inputGain);
      osc.start(time);
      osc.stop(time + 0.3);
    }

    // Any additional channels switched to Demo Stem play subtle stereo chord accent
    for (const ch of this.channelsSnapshot) {
      if (ch.type === 'audio' && ch.id !== 'ch-2' && ch.id !== 'ch-3' && ch.inputSource === 'demo' && (step === 0 || step === 8)) {
        const nodes = this.channelNodes.get(ch.id);
        if (!nodes) continue;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(step === 0 ? 261.63 : 293.66, time);
        g.gain.setValueAtTime(0.14, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
        osc.connect(g);
        g.connect(nodes.inputGain);
        osc.start(time);
        osc.stop(time + 0.48);
      }
    }
  }

  public startMixRecording(): boolean {
    if (!this.recordDest) return false;
    try {
      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(this.recordDest.stream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.mediaRecorder.start();
      return true;
    } catch {
      return false;
    }
  }

  public stopMixRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        this.recordedChunks = [];
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  public updateTransportSnapshot(transport: TransportState): void {
    this.transportSnapshot = transport;
  }

  public clearClip(channelId: string): void {
    this.peakClips.set(channelId, false);
  }

  public sampleMeters(channels: ChannelState[]): Record<string, MeterReading> {
    const readings: Record<string, MeterReading> = {};
    for (const ch of channels) {
      const nodes = this.channelNodes.get(ch.id);
      if (!nodes || !this.ctx) {
        readings[ch.id] = { left: 0, right: 0, peakDb: -60, clipped: false };
        continue;
      }

      nodes.analyserL.getFloatTimeDomainData(this.timeBufL);
      nodes.analyserR.getFloatTimeDomainData(this.timeBufR);

      let maxL = 0;
      let maxR = 0;
      for (let i = 0; i < 256; i++) {
        const aL = Math.abs(this.timeBufL[i]);
        const aR = Math.abs(this.timeBufR[i]);
        if (aL > maxL) maxL = aL;
        if (aR > maxR) maxR = aR;
      }

      const maxPeak = Math.max(maxL, maxR);
      const peakDb = linearToDb(maxPeak);
      if (maxPeak >= 0.99) {
        this.peakClips.set(ch.id, true);
      }

      // Map -60dB..+6dB -> 0..1 visually
      const normL = Math.max(0, Math.min(1, (linearToDb(maxL) + 60) / 66));
      const normR = Math.max(0, Math.min(1, (linearToDb(maxR) + 60) / 66));

      readings[ch.id] = {
        left: normL,
        right: normR,
        peakDb,
        clipped: this.peakClips.get(ch.id) ?? false,
      };
    }
    return readings;
  }

  public getMasterSpectrum(): Uint8Array {
    const master = this.channelNodes.get('main-bus');
    if (!master) return this.fftBuf;
    master.analyserL.getByteFrequencyData(this.fftBuf);
    return this.fftBuf;
  }

  public getChannelSpectrum(channelId: string, channelMode: 'L+R' | 'L' | 'R' | 'M' | 'S' = 'L+R'): Uint8Array {
    const nodes = this.channelNodes.get(channelId) ?? this.channelNodes.get('main-bus');
    if (!nodes) return this.fftBuf;
    if (channelMode === 'R') {
      nodes.analyserR.getByteFrequencyData(this.fftBuf);
      return this.fftBuf;
    }
    if (channelMode === 'L') {
      nodes.analyserL.getByteFrequencyData(this.fftBuf);
      return this.fftBuf;
    }
    const bufL = new Uint8Array(this.fftBuf.length);
    const bufR = new Uint8Array(this.fftBuf.length);
    nodes.analyserL.getByteFrequencyData(bufL);
    nodes.analyserR.getByteFrequencyData(bufR);
    for (let i = 0; i < this.fftBuf.length; i++) {
      if (channelMode === 'S') {
        this.fftBuf[i] = Math.min(255, Math.abs(bufL[i] - bufR[i]));
      } else {
        this.fftBuf[i] = Math.round((bufL[i] + bufR[i]) * 0.5);
      }
    }
    return this.fftBuf;
  }

  public getChannelReduction(channelId: string): number {
    const nodes = this.channelNodes.get(channelId);
    if (!nodes) return 0;
    return Math.min(0, nodes.compressor.reduction ?? 0);
  }

  public getChannelStereoMetrics(channelId: string): {
    peakL: number;
    peakR: number;
    rmsL: number;
    rmsR: number;
    midRms: number;
    sideRms: number;
    peakDbL: number;
    peakDbR: number;
  } {
    const nodes = this.channelNodes.get(channelId) ?? this.channelNodes.get('main-bus');
    if (!nodes || !this.ctx) {
      return { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0, midRms: 0, sideRms: 0, peakDbL: -60, peakDbR: -60 };
    }
    nodes.analyserL.getFloatTimeDomainData(this.timeBufL);
    nodes.analyserR.getFloatTimeDomainData(this.timeBufR);

    let peakL = 0;
    let peakR = 0;
    let sumSqL = 0;
    let sumSqR = 0;
    let sumSqM = 0;
    let sumSqS = 0;

    for (let i = 0; i < 256; i++) {
      const l = this.timeBufL[i];
      const r = this.timeBufR[i];
      const absL = Math.abs(l);
      const absR = Math.abs(r);
      if (absL > peakL) peakL = absL;
      if (absR > peakR) peakR = absR;
      sumSqL += l * l;
      sumSqR += r * r;
      const m = (l + r) * 0.5;
      const s = (l - r) * 0.5;
      sumSqM += m * m;
      sumSqS += s * s;
    }

    return {
      peakL,
      peakR,
      rmsL: Math.sqrt(sumSqL / 256),
      rmsR: Math.sqrt(sumSqR / 256),
      midRms: Math.sqrt(sumSqM / 256),
      sideRms: Math.sqrt(sumSqS / 256),
      peakDbL: linearToDb(peakL),
      peakDbR: linearToDb(peakR),
    };
  }

  public getDspCpuMetrics(
    channels: ChannelState[],
    asioConfig: AsioDriverConfig,
    isPlaying: boolean,
    frameDeltaMs: number
  ): {
    cpuPercent: number;
    activePlugins: number;
    activeStreams: number;
    roundTripMs: number;
  } {
    const activePlugins = channels.reduce(
      (sum, ch) => sum + ch.inserts.filter((i) => i.enabled).length,
      0
    );
    const activeStreams = channels.filter(
      (ch) => ch.inputSource !== 'none' && !ch.mute
    ).length;

    // Buffer overhead increases slightly at ultra-low buffer sizes (32 / 64 smp)
    const bufferPressure =
      asioConfig.bufferSize <= 32
        ? 4.2
        : asioConfig.bufferSize <= 64
        ? 2.6
        : asioConfig.bufferSize <= 128
        ? 1.5
        : 0.8;

    const sampleRateFactor = asioConfig.sampleRate / 48000;
    const jitterFactor = Math.max(0, Math.min(8, (frameDeltaMs - 16.7) * 0.25));
    const activeDspLoad =
      (isPlaying ? 2.4 : 0.6) +
      activePlugins * 0.55 * sampleRateFactor +
      activeStreams * 0.65 +
      bufferPressure +
      jitterFactor;

    const cpuPercent = Math.max(1, Math.min(98, Math.round(activeDspLoad)));
    const bufLatencyMs = (asioConfig.bufferSize / asioConfig.sampleRate) * 1000;
    const ctxLatencyMs = this.ctx ? (this.ctx.baseLatency ?? 0.002) * 1000 : asioConfig.baseLatencyMs;
    const roundTripMs = Number((bufLatencyMs * 2 + ctxLatencyMs).toFixed(2));

    return {
      cpuPercent,
      activePlugins,
      activeStreams,
      roundTripMs,
    };
  }

  public async playTestTone(sampleRate: number, outputDeviceId: string): Promise<boolean> {
    const ctx = await this.ensureContext(sampleRate);
    await this.resumeIfNeeded(true);
    await this.setOutputDevice(outputDeviceId);
    if (!this.masterOutputEnabled) {
      return false;
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const pan = ctx.createStereoPanner();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(554.37, now + 0.14);
    osc.frequency.setValueAtTime(659.25, now + 0.28);

    pan.pan.setValueAtTime(-0.55, now);
    pan.pan.linearRampToValueAtTime(0.55, now + 0.35);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.setValueAtTime(0.18, now + 0.38);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    osc.connect(pan);
    pan.connect(gain);
    gain.connect(this.masterOutputGain ?? ctx.destination);

    osc.start(now);
    osc.stop(now + 0.56);
    return true;
  }

  public async loadSpecialEffectAudio(padId: string, file: File): Promise<string | null> {
    const ctx = await this.ensureContext();
    try {
      const arr = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr);
      this.sfxBuffers.set(padId, decoded);
      return file.name;
    } catch {
      return null;
    }
  }

  public clearSpecialEffectAudio(padId: string): void {
    this.sfxBuffers.delete(padId);
  }

  public stopAllSpecialEffects(): void {
    for (const src of this.activeSfxSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // ignore already stopped
      }
    }
    this.activeSfxSources = [];
  }

  private registerSfxSource(src: AudioScheduledSourceNode): void {
    this.activeSfxSources.push(src);
    src.onended = () => {
      this.activeSfxSources = this.activeSfxSources.filter((s) => s !== src);
    };
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  private createSoftClipCurve(drivePercent: number): Float32Array<ArrayBuffer> {
    const samples = 1024;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const k = Math.max(0.5, (drivePercent / 100) * 18);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  public async triggerSpecialEffectPad(
    pad: SpecialEffectPad,
    channelId = 'ch-7',
    channels?: ChannelState[]
  ): Promise<void> {
    const ctx = await this.ensureContext();
    if (channels && this.channelNodes.size === 0) {
      this.rebuildGraph(channels);
    }

    const chNodes = this.channelNodes.get(channelId) ?? this.channelNodes.get('main-bus');
    if (!chNodes) return;

    const snapshot = channels ?? this.channelsSnapshot;
    const chState = snapshot.find((c) => c.id === channelId);
    const sfxPlugin = chState?.inserts.find((i) => i.type === 'special-fx');

    const pluginEnabled = sfxPlugin ? sfxPlugin.enabled : true;
    const pluginPitch = pluginEnabled ? (sfxPlugin?.params.pitch ?? 0) : 0;
    const pluginTone = pluginEnabled ? (sfxPlugin?.params.tone ?? 4200) : 18000;
    const pluginDrive = pluginEnabled ? (sfxPlugin?.params.drive ?? 18) : 0;
    const pluginMix = sfxPlugin ? (sfxPlugin.enabled ? (sfxPlugin.params.mix ?? 100) / 100 : 1) : 1;

    if (pluginMix <= 0.01) return;

    const pitchFactor = Math.pow(2, (pad.pitchSemitones + pluginPitch) / 12);
    const durSec = Math.max(0.15, Math.min(5.0, pad.durationMs / 1000));
    const padGainVal = dbToLinear(pad.volumeDb) * Math.max(0.1, pluginMix);

    const outGain = ctx.createGain();
    outGain.gain.value = padGainVal;

    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = Math.max(350, Math.min(18000, pluginTone));

    if (pluginDrive > 2) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.createSoftClipCurve(pluginDrive);
      shaper.oversample = '2x';
      outGain.connect(shaper);
      shaper.connect(toneFilter);
    } else {
      outGain.connect(toneFilter);
    }
    toneFilter.connect(chNodes.inputGain);

    const now = ctx.currentTime;
    const customBuf = this.sfxBuffers.get(pad.id);
    if (customBuf) {
      const src = ctx.createBufferSource();
      src.buffer = customBuf;
      src.playbackRate.value = pitchFactor;
      src.connect(outGain);
      this.registerSfxSource(src);
      src.start(now);
      return;
    }

    this.synthesizePreset(ctx, pad.preset, outGain, now, durSec, pitchFactor);
  }

  private synthesizePreset(
    ctx: AudioContext,
    preset: SpecialEffectPreset,
    dest: AudioNode,
    now: number,
    durSec: number,
    pitch: number
  ): void {
    const startOsc = (
      type: OscillatorType,
      freqStart: number,
      freqEnd: number | null,
      amp: number,
      t0: number,
      len: number
    ) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freqStart * pitch), t0);
      if (freqEnd !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd * pitch), t0 + len);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + Math.min(0.02, len * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      osc.connect(g);
      g.connect(dest);
      this.registerSfxSource(osc);
      osc.start(t0);
      osc.stop(t0 + len + 0.02);
    };

    switch (preset) {
      case 'airhorn': {
        const hits = [0, 0.16, 0.34];
        hits.forEach((off, idx) => {
          const len = idx === 2 ? Math.max(0.35, durSec - off) : 0.12;
          [440, 554.37, 659.25].forEach((f) => {
            startOsc('sawtooth', f, f * 0.985, 0.22, now + off, len);
          });
        });
        break;
      }
      case 'applause': {
        const noise = ctx.createBufferSource();
        noise.buffer = this.createNoiseBuffer(ctx, durSec);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1650 * pitch, now);
        bp.Q.value = 0.7;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.45, now + durSec * 0.18);
        g.gain.setValueAtTime(0.4, now + durSec * 0.65);
        g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
        noise.connect(bp);
        bp.connect(g);
        g.connect(dest);
        this.registerSfxSource(noise);
        noise.start(now);
        noise.stop(now + durSec + 0.02);
        break;
      }
      case 'laser': {
        startOsc('sawtooth', 1750, 110, 0.45, now, durSec);
        startOsc('sine', 2400, 180, 0.25, now, durSec * 0.85);
        break;
      }
      case 'riser': {
        startOsc('sawtooth', 110, 1480, 0.36, now, durSec);
        const noise = ctx.createBufferSource();
        noise.buffer = this.createNoiseBuffer(ctx, durSec);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(300 * pitch, now);
        bp.frequency.exponentialRampToValueAtTime(5200 * pitch, now + durSec);
        bp.Q.value = 3.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.02, now);
        g.gain.linearRampToValueAtTime(0.35, now + durSec * 0.92);
        g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
        noise.connect(bp);
        bp.connect(g);
        g.connect(dest);
        this.registerSfxSource(noise);
        noise.start(now);
        noise.stop(now + durSec + 0.02);
        break;
      }
      case 'subdrop': {
        startOsc('sine', 120, 28, 0.75, now, durSec);
        startOsc('triangle', 220, 42, 0.3, now, durSec * 0.6);
        break;
      }
      case 'vinyl-stop': {
        startOsc('sawtooth', 320, 24, 0.4, now, durSec);
        startOsc('triangle', 640, 32, 0.25, now, durSec);
        break;
      }
      case 'siren': {
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(760 * pitch, now);
        lfo.frequency.setValueAtTime(3.2, now);
        lfoGain.gain.setValueAtTime(240 * pitch, now);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.32, now + 0.05);
        g.gain.setValueAtTime(0.32, now + durSec * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
        osc.connect(g);
        g.connect(dest);
        this.registerSfxSource(osc);
        this.registerSfxSource(lfo);
        osc.start(now);
        lfo.start(now);
        osc.stop(now + durSec + 0.02);
        lfo.stop(now + durSec + 0.02);
        break;
      }
      case 'laugh': {
        const bursts = 5;
        const step = Math.min(0.18, durSec / bursts);
        for (let i = 0; i < bursts; i++) {
          const t0 = now + i * step;
          const base = 360 - i * 24;
          startOsc('triangle', base, base * 0.72, 0.34, t0, step * 0.85);
          startOsc('sine', base * 1.5, base * 1.1, 0.2, t0, step * 0.75);
        }
        break;
      }
      case 'bell': {
        [880, 1318.5, 1760, 2637].forEach((f, idx) => {
          startOsc('sine', f, null, 0.28 / (idx + 1), now, durSec);
        });
        break;
      }
      case 'whoosh': {
        const noise = ctx.createBufferSource();
        noise.buffer = this.createNoiseBuffer(ctx, durSec);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(220 * pitch, now);
        bp.frequency.exponentialRampToValueAtTime(3400 * pitch, now + durSec * 0.45);
        bp.frequency.exponentialRampToValueAtTime(280 * pitch, now + durSec);
        bp.Q.value = 1.8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.55, now + durSec * 0.42);
        g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
        noise.connect(bp);
        bp.connect(g);
        g.connect(dest);
        this.registerSfxSource(noise);
        noise.start(now);
        noise.stop(now + durSec + 0.02);
        break;
      }
      case 'glitch': {
        const slices = 7;
        const step = durSec / slices;
        for (let i = 0; i < slices; i++) {
          const f = 190 + ((i * 277) % 1400);
          startOsc(i % 2 === 0 ? 'square' : 'sawtooth', f, f * 1.3, 0.28, now + i * step, step * 0.75);
        }
        break;
      }
      case 'boom': {
        startOsc('sine', 95, 24, 0.8, now, durSec);
        const noise = ctx.createBufferSource();
        noise.buffer = this.createNoiseBuffer(ctx, durSec);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(850 * pitch, now);
        lp.frequency.exponentialRampToValueAtTime(120, now + durSec);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
        noise.connect(lp);
        lp.connect(g);
        g.connect(dest);
        this.registerSfxSource(noise);
        noise.start(now);
        noise.stop(now + durSec + 0.02);
        break;
      }
      case 'chime': {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          startOsc('sine', f, null, 0.25, now + i * 0.08, Math.max(0.35, durSec - i * 0.08));
        });
        break;
      }
      case 'buzzer': {
        startOsc('sawtooth', 145, 138, 0.38, now, durSec);
        startOsc('square', 152, 146, 0.28, now, durSec);
        break;
      }
      case 'scratch': {
        const steps = [
          { t: 0, f1: 280, f2: 880, len: 0.1 },
          { t: 0.11, f1: 860, f2: 240, len: 0.1 },
          { t: 0.24, f1: 260, f2: 1100, len: Math.max(0.14, durSec - 0.24) },
        ];
        steps.forEach((s) => {
          startOsc('sawtooth', s.f1, s.f2, 0.36, now + s.t, s.len);
        });
        break;
      }
      case 'drumroll': {
        const hits = 6;
        const step = Math.min(0.09, (durSec * 0.75) / hits);
        for (let i = 0; i < hits; i++) {
          startOsc('triangle', 220, 100, 0.32, now + i * step, 0.07);
        }
        startOsc('sine', 160, 48, 0.65, now + hits * step, Math.max(0.2, durSec - hits * step));
        break;
      }
      case 'echo-hit': {
        const taps = [0, 0.22, 0.44, 0.66];
        taps.forEach((off, idx) => {
          if (off < durSec) {
            startOsc('triangle', 440, 220, 0.45 * Math.pow(0.58, idx), now + off, 0.22);
          }
        });
        break;
      }
      case 'fanfare': {
        const notes = [
          { f: 523.25, t: 0, len: 0.14 },
          { f: 659.25, t: 0.14, len: 0.14 },
          { f: 783.99, t: 0.28, len: 0.14 },
          { f: 1046.5, t: 0.42, len: Math.max(0.35, durSec - 0.42) },
        ];
        notes.forEach((n) => {
          startOsc('sawtooth', n.f, null, 0.24, now + n.t, n.len);
          startOsc('triangle', n.f * 0.5, null, 0.2, now + n.t, n.len);
        });
        break;
      }
      case 'robot': {
        const notes = [320, 240, 410, 290, 520];
        const step = durSec / notes.length;
        notes.forEach((f, i) => {
          startOsc('square', f, f * 0.9, 0.25, now + i * step, step * 0.85);
        });
        break;
      }
      case 'clap': {
        [0, 0.014, 0.028].forEach((off, idx) => {
          const noise = ctx.createBufferSource();
          const len = idx === 2 ? Math.max(0.18, durSec * 0.7) : 0.03;
          noise.buffer = this.createNoiseBuffer(ctx, len);
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(1400 * pitch, now + off);
          bp.Q.value = 1.6;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.55, now + off);
          g.gain.exponentialRampToValueAtTime(0.0001, now + off + len);
          noise.connect(bp);
          bp.connect(g);
          g.connect(dest);
          this.registerSfxSource(noise);
          noise.start(now + off);
          noise.stop(now + off + len + 0.02);
        });
        break;
      }
      case 'cowbell': {
        startOsc('square', 540, null, 0.28, now, Math.min(0.45, durSec));
        startOsc('square', 800, null, 0.26, now, Math.min(0.45, durSec));
        break;
      }
      case 'crash': {
        const noise = ctx.createBufferSource();
        noise.buffer = this.createNoiseBuffer(ctx, durSec);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(3200 * pitch, now);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.55, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
        noise.connect(hp);
        hp.connect(g);
        g.connect(dest);
        this.registerSfxSource(noise);
        noise.start(now);
        noise.stop(now + durSec + 0.02);
        break;
      }
      case 'sweep-down': {
        startOsc('sawtooth', 1400, 75, 0.34, now, durSec);
        const noise = ctx.createBufferSource();
        noise.buffer = this.createNoiseBuffer(ctx, durSec);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(4800 * pitch, now);
        bp.frequency.exponentialRampToValueAtTime(220 * pitch, now + durSec);
        bp.Q.value = 3.0;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.38, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
        noise.connect(bp);
        bp.connect(g);
        g.connect(dest);
        this.registerSfxSource(noise);
        noise.start(now);
        noise.stop(now + durSec + 0.02);
        break;
      }
      case 'alarm': {
        const pulses = 3;
        const step = durSec / pulses;
        for (let i = 0; i < pulses; i++) {
          startOsc('sawtooth', 880, 620, 0.32, now + i * step, step * 0.72);
        }
        break;
      }
      case 'boing': {
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(210 * pitch, now);
        osc.frequency.exponentialRampToValueAtTime(520 * pitch, now + durSec * 0.4);
        lfo.frequency.setValueAtTime(14, now);
        lfoGain.gain.setValueAtTime(65 * pitch, now);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        g.gain.setValueAtTime(0.45, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
        osc.connect(g);
        g.connect(dest);
        this.registerSfxSource(osc);
        this.registerSfxSource(lfo);
        osc.start(now);
        lfo.start(now);
        osc.stop(now + durSec + 0.02);
        lfo.stop(now + durSec + 0.02);
        break;
      }
      case 'coin': {
        startOsc('square', 987.77, null, 0.25, now, 0.09);
        startOsc('square', 1318.51, null, 0.25, now + 0.08, Math.max(0.25, durSec - 0.08));
        break;
      }
      case 'zap': {
        startOsc('square', 1200, 90, 0.4, now, durSec);
        startOsc('sawtooth', 900, 65, 0.25, now, durSec);
        break;
      }
      case 'gong': {
        [110, 165, 224, 308].forEach((f, idx) => {
          startOsc(idx % 2 === 0 ? 'sine' : 'triangle', f, f * 0.96, 0.35 / (idx + 1), now, durSec);
        });
        break;
      }
      case 'powerup': {
        const steps = [261.63, 329.63, 392, 523.25, 659.25, 783.99];
        const step = durSec / steps.length;
        steps.forEach((f, i) => {
          startOsc('triangle', f, f * 1.05, 0.3, now + i * step, step * 1.15);
        });
        break;
      }
      case 'custom':
      default: {
        startOsc('sine', 587.33, 440, 0.4, now, durSec);
        break;
      }
    }
  }

  public async enumerateMidiDevices(): Promise<{ inputs: string[]; outputs: string[] }> {
    const nav = navigator as Navigator & {
      requestMIDIAccess?: () => Promise<{
        inputs: Map<string, { name?: string }>;
        outputs: Map<string, { name?: string }>;
      }>;
    };
    if (typeof nav.requestMIDIAccess !== 'function') {
      return { inputs: [], outputs: [] };
    }
    try {
      const access = await nav.requestMIDIAccess();
      const inputs: string[] = [];
      const outputs: string[] = [];
      access.inputs.forEach((port) => {
        if (port.name) inputs.push(port.name);
      });
      access.outputs.forEach((port) => {
        if (port.name) outputs.push(port.name);
      });
      return { inputs, outputs };
    } catch {
      return { inputs: [], outputs: [] };
    }
  }
}

export const audioEngine = new StudioAudioEngine();
