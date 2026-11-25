import {
  AsioDriverConfig,
  AudioDeviceInfo,
  ChannelState,
  MeterReading,
  TransportState,
} from '../types/mixer';

interface ChannelNodes {
  inputGain: GainNode;
  lowFilter: BiquadFilterNode;
  midFilter: BiquadFilterNode;
  highFilter: BiquadFilterNode;
  megaphoneFilter: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  revPreDelay: DelayNode;
  revDryGain: GainNode;
  revWetGain: GainNode;
  delayWetGain: GainNode;
  harmonyWetGain: GainNode;
  harmonyVoiceGains: GainNode[];
  panner: StereoPannerNode;
  faderGain: GainNode;
  fxConvolver?: ConvolverNode;
  fxDelay?: DelayNode;
  fxFeedback?: GainNode;
  fxTone?: BiquadFilterNode;
  splitter: ChannelSplitterNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
  sendGains: Map<string, GainNode>;
  micSource?: MediaStreamAudioSourceNode;
  micStream?: MediaStream;
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
  private activeBufferSources: AudioBufferSourceNode[] = [];
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

  // ASIO Bridge WebSocket
  private asioSocket: WebSocket | null = null;

  public isInitialized(): boolean {
    return this.ctx !== null;
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public async ensureContext(sampleRate: number = 48000): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try {
        // Prioritize ultra-low latency hardware callback (~2ms target)
        this.ctx = new AudioCtx({
          latencyHint: 0.002,
          sampleRate,
        });
      } catch {
        this.ctx = new AudioCtx({
          latencyHint: 'interactive',
          sampleRate,
        });
      }
      if (this.channelsSnapshot.length > 0) {
        this.rebuildGraph(this.channelsSnapshot);
      }
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  public async rebuildSampleRate(sampleRate: 44100 | 48000 | 88200 | 96000, channels: ChannelState[]): Promise<{ baseLatencyMs: number; outputLatencyMs: number }> {
    this.stopScheduler();
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.channelNodes.clear();
    }
    const ctx = await this.ensureContext(sampleRate);
    this.rebuildGraph(channels);
    const baseMs = Number(((ctx.baseLatency ?? 0.005) * 1000).toFixed(2));
    const outMs = Number((((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0.008) * 1000).toFixed(2));
    return { baseLatencyMs: baseMs, outputLatencyMs: outMs };
  }

  public async setOutputDevice(deviceId: string): Promise<boolean> {
    if (!this.ctx) return false;
    const ctxWithSink = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof ctxWithSink.setSinkId === 'function') {
      try {
        await ctxWithSink.setSinkId(deviceId === 'default' ? '' : deviceId);
        return true;
      } catch {
        return false;
      }
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
    return devices
      .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || (d.kind === 'audioinput' ? `Audio Input ${idx + 1}` : `Audio Output ${idx + 1}`),
        kind: d.kind as 'audioinput' | 'audiooutput',
        groupId: d.groupId,
      }));
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
        megaphoneFilter.type = 'bandpass';
        megaphoneFilter.frequency.value = 1450;
        megaphoneFilter.Q.value = 0.2;

        const compressor = ctx.createDynamicsCompressor();
        const revPreDelay = ctx.createDelay(0.5);
        revPreDelay.delayTime.value = 0.07;
        const revDryGain = ctx.createGain();
        revDryGain.gain.value = 1;
        const revWetGain = ctx.createGain();
        revWetGain.gain.value = 0;
        const fxConvolver = ctx.createConvolver();
        fxConvolver.buffer = createImpulseResponse(ctx, 2.4, 2.3, 4200);

        const delayWetGain = ctx.createGain();
        delayWetGain.gain.value = 0;
        const chDelay = ctx.createDelay(2.0);
        chDelay.delayTime.value = 0.5;
        const chDelayFeedback = ctx.createGain();
        chDelayFeedback.gain.value = 0.17;
        const chDelayTone = ctx.createBiquadFilter();
        chDelayTone.type = 'lowpass';
        chDelayTone.frequency.value = 4470;

        const harmonyWetGain = ctx.createGain();
        harmonyWetGain.gain.value = 0;
        const harmonyVoiceGains: GainNode[] = [];

        const panner = ctx.createStereoPanner();
        const faderGain = ctx.createGain();
        const splitter = ctx.createChannelSplitter(2);
        const analyserL = ctx.createAnalyser();
        analyserL.fftSize = 2048;
        analyserL.smoothingTimeConstant = 0.72;
        const analyserR = ctx.createAnalyser();
        analyserR.fftSize = 2048;
        analyserR.smoothingTimeConstant = 0.72;

        const nodes: ChannelNodes = {
          inputGain,
          lowFilter,
          midFilter,
          highFilter,
          megaphoneFilter,
          compressor,
          revPreDelay,
          revDryGain,
          revWetGain,
          delayWetGain,
          harmonyWetGain,
          harmonyVoiceGains,
          fxConvolver,
          fxDelay: chDelay,
          fxFeedback: chDelayFeedback,
          fxTone: chDelayTone,
          panner,
          faderGain,
          splitter,
          analyserL,
          analyserR,
          sendGains: new Map(),
        };

        // FX Bus DSP
        if (ch.type === 'fx') {
          const isReverb = ch.inserts.some((i) => i.type === 'reverb');
          const isDelay = ch.inserts.some((i) => i.type === 'delay' || i.type === 'harmony');

          if (isReverb) {
            const revPlugin = ch.inserts.find((i) => i.type === 'reverb');
            const decay = revPlugin?.params.decay ?? 2.5;
            fxConvolver.buffer = createImpulseResponse(ctx, Math.min(5, decay), 2.4, 3600);
            inputGain.connect(fxConvolver);
            fxConvolver.connect(lowFilter);
          } else if (isDelay) {
            const delPlugin = ch.inserts.find((i) => i.type === 'delay');
            chDelay.delayTime.value = (delPlugin?.params.timeMs ?? 320) / 1000;
            chDelayFeedback.gain.value = Math.min(0.85, (delPlugin?.params.feedback ?? 35) / 100);
            chDelayTone.frequency.value = delPlugin?.params.tone ?? 3200;

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

        // Parallel Wet/Dry Insert Reverb path
        compressor.connect(revDryGain);
        revDryGain.connect(panner);
        compressor.connect(revPreDelay);
        revPreDelay.connect(fxConvolver);
        fxConvolver.connect(revWetGain);
        revWetGain.connect(panner);

        // Parallel Insert Delay path (active on Ch 5 DELAY or any channel with Beat Delay)
        if (ch.type !== 'fx') {
          compressor.connect(chDelay);
          chDelay.connect(chDelayTone);
          chDelayTone.connect(chDelayFeedback);
          chDelayFeedback.connect(chDelay);
          chDelayTone.connect(delayWetGain);
          delayWetGain.connect(panner);

          // 4-voice Stereo Harmony / Pitch-Chorus Ensemble taps
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

            compressor.connect(vDelay);
            vDelay.connect(vGain);
            vGain.connect(vPan);
            vPan.connect(harmonyWetGain);
            harmonyVoiceGains.push(vGain);
          });
          harmonyWetGain.connect(panner);
        }

        panner.connect(faderGain);

        faderGain.connect(splitter);
        splitter.connect(analyserL, 0);
        splitter.connect(analyserR, 1);

        // Master metering FFT
        if (ch.type === 'master') {
          analyserL.fftSize = 2048;
          this.fftBuf = new Uint8Array(analyserL.frequencyBinCount);
          this.recordDest = ctx.createMediaStreamDestination();
          faderGain.connect(ctx.destination);
          faderGain.connect(this.recordDest);
        }

        this.channelNodes.set(ch.id, nodes);
      }
    }

    // Ensure internal FX Send buses exist (REVERB, HALL, DELAY) even when hidden from mixer
    const internalFxDefs = [
      { id: 'fx-reverb-internal', mode: 'reverb', decay: 2.4 },
      { id: 'fx-hall-internal', mode: 'reverb', decay: 4.0 },
      { id: 'fx-delay-internal', mode: 'delay', timeMs: 360 },
    ] as const;

    const masterNode = this.channelNodes.get('main-bus');
    if (masterNode) {
      for (const fxDef of internalFxDefs) {
        if (!this.channelNodes.has(fxDef.id)) {
          const inputGain = ctx.createGain();
          const lowFilter = ctx.createBiquadFilter();
          lowFilter.type = 'highpass';
          lowFilter.frequency.value = 160;
          const midFilter = ctx.createBiquadFilter();
          const highFilter = ctx.createBiquadFilter();
          const megaphoneFilter = ctx.createBiquadFilter();
          megaphoneFilter.type = 'allpass';
          const compressor = ctx.createDynamicsCompressor();
          const revPreDelay = ctx.createDelay(0.5);
          const revDryGain = ctx.createGain();
          const revWetGain = ctx.createGain();
          const delayWetGain = ctx.createGain();
          const harmonyWetGain = ctx.createGain();
          const panner = ctx.createStereoPanner();
          const faderGain = ctx.createGain();
          faderGain.gain.value = 0.7;
          const splitter = ctx.createChannelSplitter(2);
          const analyserL = ctx.createAnalyser();
          const analyserR = ctx.createAnalyser();

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
            revPreDelay,
            revDryGain,
            revWetGain,
            delayWetGain,
            harmonyWetGain,
            harmonyVoiceGains: [],
            panner,
            faderGain,
            splitter,
            analyserL,
            analyserR,
            sendGains: new Map(),
          });
        }
      }

      for (const ch of channels) {
        const nodes = this.channelNodes.get(ch.id);
        if (!nodes) continue;
        if (ch.type === 'audio' || ch.type === 'fx') {
          try {
            nodes.faderGain.disconnect(masterNode.inputGain);
          } catch {
            // not yet connected
          }
          nodes.faderGain.connect(masterNode.inputGain);
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

      // Megaphone bandpass insert
      const mega = ch.inserts.find((i) => i.type === 'megaphone' && i.enabled);
      if (mega) {
        nodes.megaphoneFilter.type = 'bandpass';
        nodes.megaphoneFilter.frequency.setTargetAtTime(mega.params.focusHz ?? 1450, now, 0.02);
        nodes.megaphoneFilter.Q.setTargetAtTime(mega.params.q ?? 2.4, now, 0.02);
      } else {
        nodes.megaphoneFilter.type = 'allpass';
        nodes.megaphoneFilter.Q.setTargetAtTime(0.1, now, 0.02);
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
      if (nodes.fxDelay && nodes.fxFeedback && nodes.fxTone) {
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
      if (revIns && ch.type !== 'fx') {
        const mixNorm = Math.max(0, Math.min(1, (revIns.params.mix ?? 100) / 100));
        const preDelaySec = Math.max(0, Math.min(0.45, (revIns.params.preDelay ?? 70) / 1000));
        nodes.revPreDelay.delayTime.setTargetAtTime(preDelaySec, now, 0.006);
        nodes.revDryGain.gain.setTargetAtTime(1 - mixNorm * 0.65, now, 0.006);
        nodes.revWetGain.gain.setTargetAtTime(mixNorm * 0.9, now, 0.006);
      } else {
        nodes.revDryGain.gain.setTargetAtTime(1, now, 0.006);
        nodes.revWetGain.gain.setTargetAtTime(0, now, 0.006);
      }

      // Harmony 1/2/3/4 Voice Insert DSP
      const harmIns = ch.inserts.find((i) => i.type === 'harmony' && i.enabled);
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
      return true;
    }

    try {
      const lowLatencyConstraints = {
        deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        latency: 0.002,
      } as MediaTrackConstraints;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: lowLatencyConstraints,
      });
      if (nodes.micSource) nodes.micSource.disconnect();
      if (nodes.micStream) nodes.micStream.getTracks().forEach((t) => t.stop());

      const src = ctx.createMediaStreamSource(stream);
      src.connect(nodes.inputGain);
      nodes.micSource = src;
      nodes.micStream = stream;
      return true;
    } catch {
      return false;
    }
  }

  public async enableApplicationAudioInput(channelId: string): Promise<boolean> {
    const ctx = await this.ensureContext();
    const nodes = this.channelNodes.get(channelId);
    if (!nodes || !navigator.mediaDevices?.getDisplayMedia) return false;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
      });
      // Stop unused video tracks; keep only audio stream
      stream.getVideoTracks().forEach((vt) => vt.stop());
      if (stream.getAudioTracks().length === 0) return false;

      if (nodes.micSource) nodes.micSource.disconnect();
      if (nodes.micStream) nodes.micStream.getTracks().forEach((t) => t.stop());

      const src = ctx.createMediaStreamSource(stream);
      src.connect(nodes.inputGain);
      nodes.micSource = src;
      nodes.micStream = stream;
      return true;
    } catch {
      return false;
    }
  }

  public async loadAudioFileForChannel(channelId: string, file: File): Promise<{ peaks: number[]; duration: number } | null> {
    const ctx = await this.ensureContext();
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
    this.rebuildGraph(channels);
    this.transportSnapshot = transport;
    this.stopScheduler();

    // Launch custom loaded audio files if present
    for (const ch of channels) {
      const buf = this.customBuffers.get(ch.id);
      const nodes = this.channelNodes.get(ch.id);
      if (buf && nodes && ch.inputSource === 'file') {
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

  public async playTestTone(sampleRate: number, outputDeviceId: string): Promise<void> {
    const ctx = await this.ensureContext(sampleRate);
    await this.setOutputDevice(outputDeviceId);
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
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.56);
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
