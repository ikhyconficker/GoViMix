const WORKLET_SOURCE = `
const RING_MASK = 4095;
const RING_SIZE = 4096;
const WIN_SIZE = 2048;

class GoViMixGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.thresholdDb = -54;
    this.rangeDb = -18;
    this.attackMs = 20;
    this.holdMs = 50;
    this.releaseMs = 250;
    this.lookAhead = true;
    this.ducking = false;
    this.scFilter = false;
    this.lowCutHz = 80;
    this.highCutHz = 10000;
    this.scSwap = false;
    this.scListen = false;

    this.env = 0;
    this.holdSamples = 0;
    this.gateGain = 1;
    this.hpStateL = 0;
    this.hpPrevL = 0;
    this.hpStateR = 0;
    this.hpPrevR = 0;
    this.lpStateL = 0;
    this.lpStateR = 0;

    this.delayL = new Float32Array(256);
    this.delayR = new Float32Array(256);
    this.delayIdx = 0;
    this.reportCounter = 0;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.enabled !== undefined) this.enabled = Boolean(d.enabled);
      if (d.thresholdDb !== undefined) this.thresholdDb = d.thresholdDb;
      if (d.rangeDb !== undefined) this.rangeDb = d.rangeDb;
      if (d.attackMs !== undefined) this.attackMs = Math.max(0.1, d.attackMs);
      if (d.holdMs !== undefined) this.holdMs = Math.max(0, d.holdMs);
      if (d.releaseMs !== undefined) this.releaseMs = Math.max(5, d.releaseMs);
      if (d.lookAhead !== undefined) this.lookAhead = Boolean(d.lookAhead);
      if (d.ducking !== undefined) this.ducking = Boolean(d.ducking);
      if (d.scFilter !== undefined) this.scFilter = Boolean(d.scFilter);
      if (d.lowCutHz !== undefined) this.lowCutHz = Math.max(20, d.lowCutHz);
      if (d.highCutHz !== undefined) this.highCutHz = Math.max(200, d.highCutHz);
      if (d.scSwap !== undefined) this.scSwap = Boolean(d.scSwap);
      if (d.scListen !== undefined) this.scListen = Boolean(d.scListen);
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    const outL = output[0];
    const outR = output[1] || outL;
    const len = outL.length;

    if (!inL) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    if (!this.enabled) {
      outL.set(inL);
      if (outR !== outL && inR) outR.set(inR);
      this.gateGain = 1;
      this.reportCounter += len;
      if (this.reportCounter >= 2048) {
        this.reportCounter = 0;
        this.port.postMessage({ attenDb: 0 });
      }
      return true;
    }

    const sr = sampleRate;
    const threshLin = Math.pow(10, this.thresholdDb / 20);
    const floorLin = this.rangeDb <= -59.5 ? 0 : Math.pow(10, this.rangeDb / 20);
    const attackAlpha = 1 - Math.exp(-1 / Math.max(1, (this.attackMs / 1000) * sr));
    const releaseAlpha = 1 - Math.exp(-1 / Math.max(1, (this.releaseMs / 1000) * sr));
    const holdMax = Math.floor((this.holdMs / 1000) * sr);
    const lookSamples = this.lookAhead ? Math.min(192, Math.floor(0.003 * sr)) : 0;

    // 1-pole sidechain filter coefficients
    const hpAlpha = Math.exp((-2 * Math.PI * this.lowCutHz) / sr);
    const lpAlpha = 1 - Math.exp((-2 * Math.PI * this.highCutHz) / sr);

    for (let i = 0; i < len; i++) {
      const sL = inL[i];
      const sR = inR ? inR[i] : sL;

      let scL = sL;
      let scR = sR;
      if (this.scFilter) {
        const hpL = hpAlpha * (this.hpStateL + scL - this.hpPrevL);
        this.hpPrevL = scL;
        this.hpStateL = hpL;

        const hpR = hpAlpha * (this.hpStateR + scR - this.hpPrevR);
        this.hpPrevR = scR;
        this.hpStateR = hpR;

        this.lpStateL += lpAlpha * (hpL - this.lpStateL);
        this.lpStateR += lpAlpha * (hpR - this.lpStateR);

        if (this.scSwap) {
          scL = sL - this.lpStateL;
          scR = sR - this.lpStateR;
        } else {
          scL = this.lpStateL;
          scR = this.lpStateR;
        }
      }

      const peak = Math.max(Math.abs(scL), Math.abs(scR));
      // Fast envelope follower
      if (peak > this.env) {
        this.env += (peak - this.env) * 0.15;
      } else {
        this.env += (peak - this.env) * 0.003;
      }

      let open;
      if (this.ducking) {
        open = this.env < threshLin;
      } else {
        open = this.env >= threshLin;
      }

      if (open) {
        this.holdSamples = holdMax;
      } else if (this.holdSamples > 0) {
        this.holdSamples--;
      }

      const isGateOpen = open || this.holdSamples > 0;
      const targetGain = isGateOpen ? 1 : floorLin;
      const coeff = targetGain > this.gateGain ? attackAlpha : releaseAlpha;
      this.gateGain += (targetGain - this.gateGain) * coeff;

      // Write audio to lookahead delay line
      this.delayL[this.delayIdx] = sL;
      this.delayR[this.delayIdx] = sR;
      const readIdx = (this.delayIdx - lookSamples) & 255;
      const dL = this.delayL[readIdx];
      const dR = this.delayR[readIdx];
      this.delayIdx = (this.delayIdx + 1) & 255;

      if (this.scListen) {
        outL[i] = scL;
        if (outR !== outL) outR[i] = scR;
      } else {
        outL[i] = dL * this.gateGain;
        if (outR !== outL) outR[i] = dR * this.gateGain;
      }
    }

    this.reportCounter += len;
    if (this.reportCounter >= 1536) {
      this.reportCounter = 0;
      const attenDb = this.gateGain <= 0.0001 ? 60 : Math.max(0, -20 * Math.log10(this.gateGain));
      this.port.postMessage({ attenDb });
    }

    return true;
  }
}

class GoViMixHarmonyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.dryGain = 1.0;
    this.wetMix = 0.75;
    this.width = 1.1;
    this.humanize = 0.25;
    this.voices = [
      { active: true, ratio: Math.pow(2, 4 / 12), gain: 0.79, panL: 0.85, panR: 0.52 },
      { active: true, ratio: Math.pow(2, 7 / 12), gain: 0.71, panL: 0.52, panR: 0.85 },
      { active: false, ratio: Math.pow(2, -5 / 12), gain: 0.56, panL: 0.94, panR: 0.34 },
      { active: false, ratio: 2.0, gain: 0.5, panL: 0.34, panR: 0.94 },
    ];
    this.phases = [0, 0.25, 0.5, 0.75];
    this.lfoPhase = 0;

    this.ringL = new Float32Array(RING_SIZE);
    this.ringR = new Float32Array(RING_SIZE);
    this.writeIdx = 0;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.enabled !== undefined) this.enabled = Boolean(d.enabled);
      if (d.dryGain !== undefined) this.dryGain = d.dryGain;
      if (d.wetMix !== undefined) this.wetMix = d.wetMix;
      if (d.width !== undefined) this.width = d.width;
      if (d.humanize !== undefined) this.humanize = d.humanize;
      if (Array.isArray(d.voices)) {
        for (let v = 0; v < 4 && v < d.voices.length; v++) {
          const vc = d.voices[v];
          this.voices[v] = {
            active: Boolean(vc.active),
            ratio: Math.max(0.25, Math.min(3.0, vc.ratio || 1)),
            gain: Math.max(0, Math.min(2.0, vc.gain ?? 0.7)),
            panL: vc.panL ?? 0.707,
            panR: vc.panR ?? 0.707,
          };
        }
      }
    };
  }

  readInterp(buf, idxFloat) {
    const idx0 = Math.floor(idxFloat) & RING_MASK;
    const idx1 = (idx0 + 1) & RING_MASK;
    const frac = idxFloat - Math.floor(idxFloat);
    return buf[idx0] + (buf[idx1] - buf[idx0]) * frac;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    const outL = output[0];
    const outR = output[1] || outL;
    const len = outL.length;

    if (!inL) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    if (!this.enabled) {
      outL.set(inL);
      if (outR !== outL && inR) outR.set(inR);
      return true;
    }

    const lfoStep = (2 * Math.PI * 1.4) / sampleRate;

    for (let i = 0; i < len; i++) {
      const sL = inL[i];
      const sR = inR ? inR[i] : sL;
      const monoIn = (sL + sR) * 0.5;

      this.ringL[this.writeIdx] = sL;
      this.ringR[this.writeIdx] = sR;

      this.lfoPhase += lfoStep;
      if (this.lfoPhase > 6.2831853) this.lfoPhase -= 6.2831853;

      let wetL = 0;
      let wetR = 0;

      for (let v = 0; v < 4; v++) {
        const vc = this.voices[v];
        if (!vc.active || vc.gain <= 0.001) continue;

        const humCents = this.humanize * 8 * Math.sin(this.lfoPhase + v * 1.57);
        const effRatio = vc.ratio * Math.pow(2, humCents / 1200);
        const phaseInc = (1 - effRatio) / WIN_SIZE;

        let phA = this.phases[v] + phaseInc;
        phA = phA - Math.floor(phA);
        this.phases[v] = phA;

        const phB = (phA + 0.5) % 1;
        const wA = 0.5 * (1 - Math.cos(6.2831853 * phA));
        const wB = 1 - wA;

        const voiceDelayOffset = 24 + v * 18;
        const readPosA = this.writeIdx - (voiceDelayOffset + phA * WIN_SIZE);
        const readPosB = this.writeIdx - (voiceDelayOffset + phB * WIN_SIZE);

        const sampleA = this.readInterp(this.ringL, readPosA) * 0.5 + this.readInterp(this.ringR, readPosA) * 0.5;
        const sampleB = this.readInterp(this.ringL, readPosB) * 0.5 + this.readInterp(this.ringR, readPosB) * 0.5;
        const shifted = (sampleA * wA + sampleB * wB) * vc.gain;

        wetL += shifted * vc.panL;
        wetR += shifted * vc.panR;
      }

      // Apply Stereo Width on wet harmony return
      const mid = (wetL + wetR) * 0.5;
      const side = (wetL - wetR) * 0.5 * this.width;
      const wideL = (mid + side) * this.wetMix;
      const wideR = (mid - side) * this.wetMix;

      outL[i] = sL * this.dryGain + wideL;
      if (outR !== outL) {
        outR[i] = sR * this.dryGain + wideR;
      } else {
        outL[i] = monoIn * this.dryGain + (wideL + wideR) * 0.5;
      }

      this.writeIdx = (this.writeIdx + 1) & RING_MASK;
    }

    return true;
  }
}

class GoViMixSaturationProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.mode = 0; // 0: Tube, 1: Tape, 2: Crunch, 3: Diode
    this.drive = 32;
    this.harmonics = 38;
    this.lowCutHz = 85;
    this.toneHz = 7200;
    this.outputDb = 0;
    this.autoGain = true;
    this.mix = 0.75;

    this.hpStateL = 0;
    this.hpPrevL = 0;
    this.hpStateR = 0;
    this.hpPrevR = 0;
    this.prevInL = 0;
    this.prevInR = 0;
    this.lpStateL = 0;
    this.lpStateR = 0;
    this.dcStateL = 0;
    this.dcStateR = 0;

    this.inSqSum = 0;
    this.outSqSum = 0;
    this.satSum = 0;
    this.reportCounter = 0;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.enabled !== undefined) this.enabled = Boolean(d.enabled);
      if (d.mode !== undefined) this.mode = Math.max(0, Math.min(3, Math.round(d.mode)));
      if (d.drive !== undefined) this.drive = Math.max(0, Math.min(100, d.drive));
      if (d.harmonics !== undefined) this.harmonics = Math.max(-100, Math.min(100, d.harmonics));
      if (d.lowCutHz !== undefined) this.lowCutHz = Math.max(20, Math.min(600, d.lowCutHz));
      if (d.toneHz !== undefined) this.toneHz = Math.max(600, Math.min(20000, d.toneHz));
      if (d.outputDb !== undefined) this.outputDb = Math.max(-24, Math.min(18, d.outputDb));
      if (d.autoGain !== undefined) this.autoGain = Boolean(d.autoGain);
      if (d.mix !== undefined) this.mix = Math.max(0, Math.min(1, d.mix));
    };
  }

  shapeSample(x, driveGain, bias, evenAmt) {
    const xb = x * driveGain + bias;
    let y = 0;
    if (this.mode === 0) {
      // Tube: warm triode tanh + 2nd-order even harmonic content
      const t = Math.tanh(xb) - Math.tanh(bias);
      const norm = 1 / Math.max(0.4, Math.tanh(driveGain));
      y = t * norm + evenAmt * (x * x * driveGain * 0.28);
    } else if (this.mode === 1) {
      // Tape: smooth magnetic compression tanh
      const norm = 1 / Math.max(0.4, Math.tanh(driveGain * 0.9));
      y = (Math.tanh(xb * 0.9) - Math.tanh(bias * 0.9)) * norm;
    } else if (this.mode === 2) {
      // Crunch: odd-harmonic arctan overdrive
      const k = driveGain * 1.45;
      y = ((2 / Math.PI) * Math.atan(x * k + bias * 0.8)) + evenAmt * 0.15 * x * x;
    } else {
      // Diode: asymmetric hard/soft clipping
      const pos = xb >= 0 ? Math.tanh(xb * 1.55) : Math.max(-0.88, Math.min(0.88, xb * 1.9));
      y = pos - Math.tanh(bias * 0.6);
    }
    return Math.max(-1.8, Math.min(1.8, y));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    const outL = output[0];
    const outR = output[1] || outL;
    const len = outL.length;

    if (!inL) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    if (!this.enabled) {
      outL.set(inL);
      if (outR !== outL && inR) outR.set(inR);
      this.reportCounter += len;
      if (this.reportCounter >= 2048) {
        this.reportCounter = 0;
        this.port.postMessage({ driveDb: 0, satAmount: 0, inRmsDb: -60, outRmsDb: -60 });
      }
      return true;
    }

    const sr = sampleRate;
    const hpAlpha = Math.exp((-2 * Math.PI * this.lowCutHz) / sr);
    const lpAlpha = 1 - Math.exp((-2 * Math.PI * this.toneHz) / sr);
    const driveNorm = this.drive / 100;
    const driveGain = 1 + driveNorm * 10.5;
    const harmNorm = this.harmonics / 100;
    const bias = harmNorm * 0.28;
    const evenAmt = Math.max(0, -harmNorm) * 0.5 + (this.mode === 0 ? 0.18 : 0);
    const autoTrim = this.autoGain ? 1 / (1 + driveNorm * 0.62) : 1;
    const outTrim = Math.pow(10, this.outputDb / 20) * autoTrim;
    const wetMix = this.mix;
    const dryMix = 1 - wetMix;

    for (let i = 0; i < len; i++) {
      const sL = inL[i];
      const sR = inR ? inR[i] : sL;

      // Pre-saturation HPF on wet path
      const hpL = hpAlpha * (this.hpStateL + sL - this.hpPrevL);
      this.hpPrevL = sL;
      this.hpStateL = hpL;

      const hpR = hpAlpha * (this.hpStateR + sR - this.hpPrevR);
      this.hpPrevR = sR;
      this.hpStateR = hpR;

      // 2x oversampled waveshaping
      const midL = (this.prevInL + hpL) * 0.5;
      const midR = (this.prevInR + hpR) * 0.5;
      this.prevInL = hpL;
      this.prevInR = hpR;

      const shL = (this.shapeSample(midL, driveGain, bias, evenAmt) + this.shapeSample(hpL, driveGain, bias, evenAmt)) * 0.5;
      const shR = (this.shapeSample(midR, driveGain, bias, evenAmt) + this.shapeSample(hpR, driveGain, bias, evenAmt)) * 0.5;

      // DC blocker (~10 Hz)
      this.dcStateL += 0.0012 * (shL - this.dcStateL);
      this.dcStateR += 0.0012 * (shR - this.dcStateR);
      const cleanL = shL - this.dcStateL;
      const cleanR = shR - this.dcStateR;

      // Post-shaper Tone LPF
      this.lpStateL += lpAlpha * (cleanL - this.lpStateL);
      this.lpStateR += lpAlpha * (cleanR - this.lpStateR);

      const wetL = this.lpStateL * outTrim;
      const wetR = this.lpStateR * outTrim;

      const finalL = sL * dryMix + wetL * wetMix;
      const finalR = sR * dryMix + wetR * wetMix;

      outL[i] = finalL;
      if (outR !== outL) outR[i] = finalR;

      this.inSqSum += sL * sL + sR * sR;
      this.outSqSum += finalL * finalL + finalR * finalR;
      const diff = Math.abs(cleanL - hpL) + Math.abs(cleanR - hpR);
      this.satSum += diff * 0.5;
    }

    this.reportCounter += len;
    if (this.reportCounter >= 1536) {
      const n = this.reportCounter * 2;
      const inRms = Math.sqrt(this.inSqSum / Math.max(1, n));
      const outRms = Math.sqrt(this.outSqSum / Math.max(1, n));
      const inRmsDb = inRms > 1e-5 ? Math.max(-60, 20 * Math.log10(inRms)) : -60;
      const outRmsDb = outRms > 1e-5 ? Math.max(-60, 20 * Math.log10(outRms)) : -60;
      const satRatio = this.satSum / Math.max(1, this.reportCounter);
      const satAmount = Math.min(1, satRatio * 2.5 * wetMix);
      const driveDb = satAmount * 18;

      this.inSqSum = 0;
      this.outSqSum = 0;
      this.satSum = 0;
      this.reportCounter = 0;
      this.port.postMessage({ driveDb, satAmount, inRmsDb, outRmsDb });
    }

    return true;
  }
}

class GoViMixMultibandProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.xovers = [65.1, 241.9, 1940, 5980];
    this.globalGainDb = 0;
    this.mix = 1.0;
    this.bands = [
      { lowThresh: -12, ratio: 2, gainDb: 0, attackMs: 12, releaseMs: 120, bypass: false, mute: false, env: 0, gainLin: 1 },
      { lowThresh: -14, ratio: 2, gainDb: 0, attackMs: 12, releaseMs: 120, bypass: false, mute: false, env: 0, gainLin: 1 },
      { lowThresh: -16, ratio: 2, gainDb: 0, attackMs: 12, releaseMs: 120, bypass: false, mute: false, env: 0, gainLin: 1 },
      { lowThresh: -18, ratio: 2, gainDb: 0, attackMs: 12, releaseMs: 120, bypass: false, mute: false, env: 0, gainLin: 1 },
      { lowThresh: -20, ratio: 2, gainDb: 0, attackMs: 12, releaseMs: 120, bypass: false, mute: false, env: 0, gainLin: 1 },
    ];
    this.lpL = [0, 0, 0, 0];
    this.lpR = [0, 0, 0, 0];

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.enabled !== undefined) this.enabled = Boolean(d.enabled);
      if (Array.isArray(d.xovers) && d.xovers.length === 4) {
        this.xovers = d.xovers.map((f) => Math.max(20, Math.min(18000, f)));
      }
      if (d.globalGainDb !== undefined) this.globalGainDb = d.globalGainDb;
      if (d.mix !== undefined) this.mix = Math.max(0, Math.min(1, d.mix));
      if (Array.isArray(d.bands)) {
        for (let b = 0; b < 5 && b < d.bands.length; b++) {
          const src = d.bands[b];
          this.bands[b].lowThresh = src.lowThresh ?? -16;
          this.bands[b].ratio = Math.max(1, src.ratio ?? 2);
          this.bands[b].gainDb = src.gainDb ?? 0;
          this.bands[b].attackMs = Math.max(0.5, src.attackMs ?? 12);
          this.bands[b].releaseMs = Math.max(10, src.releaseMs ?? 120);
          this.bands[b].bypass = Boolean(src.bypass);
          this.bands[b].mute = Boolean(src.mute);
        }
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    const outL = output[0];
    const outR = output[1] || outL;
    const len = outL.length;

    if (!inL) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    if (!this.enabled) {
      outL.set(inL);
      if (outR !== outL && inR) outR.set(inR);
      return true;
    }

    const sr = sampleRate;
    const a0 = 1 - Math.exp((-2 * Math.PI * this.xovers[0]) / sr);
    const a1 = 1 - Math.exp((-2 * Math.PI * this.xovers[1]) / sr);
    const a2 = 1 - Math.exp((-2 * Math.PI * this.xovers[2]) / sr);
    const a3 = 1 - Math.exp((-2 * Math.PI * this.xovers[3]) / sr);
    const alphas = [a0, a1, a2, a3];
    const globalLin = Math.pow(10, this.globalGainDb / 20);
    const wetMix = this.mix;
    const dryMix = 1 - wetMix;

    const bandGains = new Float32Array(5);
    const bandTargets = new Float32Array(5);
    const bandAtk = new Float32Array(5);
    const bandRel = new Float32Array(5);

    for (let b = 0; b < 5; b++) {
      const bd = this.bands[b];
      bandGains[b] = bd.mute ? 0 : Math.pow(10, bd.gainDb / 20);
      bandTargets[b] = Math.pow(10, bd.lowThresh / 20);
      bandAtk[b] = 1 - Math.exp(-1 / Math.max(1, (bd.attackMs / 1000) * sr));
      bandRel[b] = 1 - Math.exp(-1 / Math.max(1, (bd.releaseMs / 1000) * sr));
    }

    for (let i = 0; i < len; i++) {
      const sL = inL[i];
      const sR = inR ? inR[i] : sL;

      let remL = sL;
      let remR = sR;
      let sumL = 0;
      let sumR = 0;

      for (let b = 0; b < 5; b++) {
        let bL, bR;
        if (b < 4) {
          this.lpL[b] += alphas[b] * (remL - this.lpL[b]);
          this.lpR[b] += alphas[b] * (remR - this.lpR[b]);
          bL = this.lpL[b];
          bR = this.lpR[b];
          remL -= bL;
          remR -= bR;
        } else {
          bL = remL;
          bR = remR;
        }

        const bd = this.bands[b];
        if (bd.mute) {
          continue;
        }
        if (bd.bypass) {
          sumL += bL;
          sumR += bR;
          continue;
        }

        const peak = Math.max(Math.abs(bL), Math.abs(bR));
        const alpha = peak > bd.env ? bandAtk[b] : bandRel[b];
        bd.env += (peak - bd.env) * alpha;

        let compGain = 1;
        const thresh = bandTargets[b];
        if (bd.env > thresh && thresh > 1e-6) {
          const overDb = 20 * Math.log10(bd.env / thresh);
          const redDb = overDb * (1 - 1 / bd.ratio);
          compGain = Math.pow(10, -redDb / 20);
        }
        bd.gainLin += (compGain - bd.gainLin) * 0.05;

        const g = bd.gainLin * bandGains[b];
        sumL += bL * g;
        sumR += bR * g;
      }

      const wetL = sumL * globalLin;
      const wetR = sumR * globalLin;
      outL[i] = sL * dryMix + wetL * wetMix;
      if (outR !== outL) outR[i] = sR * dryMix + wetR * wetMix;
    }

    return true;
  }
}

class GoViMixDuckingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.thresholdDb = -24;
    this.depthDb = -6;
    this.attackMs = 8;
    this.releaseMs = 180;
    this.keyEnv = 0;
    this.duckGain = 1;
    this.reportCounter = 0;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.enabled !== undefined) this.enabled = Boolean(d.enabled);
      if (d.thresholdDb !== undefined) this.thresholdDb = d.thresholdDb;
      if (d.depthDb !== undefined) this.depthDb = Math.max(-36, Math.min(0, d.depthDb));
      if (d.attackMs !== undefined) this.attackMs = Math.max(0.5, d.attackMs);
      if (d.releaseMs !== undefined) this.releaseMs = Math.max(10, d.releaseMs);
    };
  }

  process(inputs, outputs) {
    const mainIn = inputs[0];
    const keyIn = inputs[1];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = mainIn && mainIn[0] ? mainIn[0] : null;
    const inR = mainIn && mainIn[1] ? mainIn[1] : inL;
    const outL = output[0];
    const outR = output[1] || outL;
    const len = outL.length;

    if (!inL) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    if (!this.enabled) {
      outL.set(inL);
      if (outR !== outL && inR) outR.set(inR);
      this.duckGain = 1;
      return true;
    }

    const keyL = keyIn && keyIn[0] ? keyIn[0] : null;
    const keyR = keyIn && keyIn[1] ? keyIn[1] : keyL;
    const sr = sampleRate;
    const threshLin = Math.pow(10, this.thresholdDb / 20);
    const depthLin = Math.pow(10, this.depthDb / 20);
    const atkAlpha = 1 - Math.exp(-1 / Math.max(1, (this.attackMs / 1000) * sr));
    const relAlpha = 1 - Math.exp(-1 / Math.max(1, (this.releaseMs / 1000) * sr));

    for (let i = 0; i < len; i++) {
      const kPeak = keyL ? Math.max(Math.abs(keyL[i]), keyR ? Math.abs(keyR[i]) : 0) : 0;
      if (kPeak > this.keyEnv) {
        this.keyEnv += (kPeak - this.keyEnv) * 0.25;
      } else {
        this.keyEnv += (kPeak - this.keyEnv) * 0.004;
      }

      const target = this.keyEnv >= threshLin ? depthLin : 1;
      const coeff = target < this.duckGain ? atkAlpha : relAlpha;
      this.duckGain += (target - this.duckGain) * coeff;

      outL[i] = inL[i] * this.duckGain;
      if (outR !== outL && inR) outR[i] = inR[i] * this.duckGain;
    }

    this.reportCounter += len;
    if (this.reportCounter >= 1536) {
      this.reportCounter = 0;
      const duckDb = this.duckGain <= 0.001 ? -36 : Math.min(0, 20 * Math.log10(this.duckGain));
      this.port.postMessage({ duckDb });
    }

    return true;
  }
}

registerProcessor('govimix-gate-processor', GoViMixGateProcessor);
registerProcessor('govimix-harmony-processor', GoViMixHarmonyProcessor);
registerProcessor('govimix-saturation-processor', GoViMixSaturationProcessor);
registerProcessor('govimix-multiband-processor', GoViMixMultibandProcessor);
registerProcessor('govimix-ducking-processor', GoViMixDuckingProcessor);
`;

const registeredContexts = new WeakSet<AudioContext>();
const pendingRegistrations = new WeakMap<AudioContext, Promise<boolean>>();

export async function ensureGoViMixWorklets(ctx: AudioContext): Promise<boolean> {
  if (registeredContexts.has(ctx)) return true;
  const existing = pendingRegistrations.get(ctx);
  if (existing) return existing;

  const task = (async () => {
    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') {
      return false;
    }
    try {
      const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      registeredContexts.add(ctx);
      return true;
    } catch {
      return false;
    }
  })();

  pendingRegistrations.set(ctx, task);
  return task;
}
