import { AudioDeviceInfo, MicChannelMode } from '../types/mixer';

export function isStereoVirtualInputLabel(label: string): boolean {
  return /\b(vc|virtual|loopback|stereo\s*mix|cable|what\s*u\s*hear|line\s*in|aux)\b/i.test(label);
}

export function inferMicChannelMode(label: string): MicChannelMode {
  return isStereoVirtualInputLabel(label) ? 'stereo' : 'mono-lr';
}

export function matchHardwareDeviceForChannelLabel(
  channelLabel: string,
  devices: AudioDeviceInfo[],
  kind: 'audioinput' | 'audiooutput'
): AudioDeviceInfo | undefined {
  const pool = devices.filter((d) => d.kind === kind);
  if (pool.length === 0) return undefined;

  // 1. Exact label match
  const exact = pool.find((d) => d.label === channelLabel);
  if (exact) return exact;

  const lower = channelLabel.toLowerCase();

  // 2. Maono / Virtual Channel / Loopback pattern matching
  if (lower.includes('loopback')) {
    return pool.find((d) => /loopback|stereo\s*mix|what\s*u\s*hear/i.test(d.label));
  }

  if (/\bvc\b/.test(lower) && (lower.includes('3') || lower.includes('4'))) {
    return pool.find((d) =>
      /(vc|virtual|cable|aux).*(3|4|\bb\b)|maono.*(3|4)/i.test(d.label)
    );
  }

  if (/\bvc\b/.test(lower) && (lower.includes('1') || lower.includes('2'))) {
    return pool.find((d) =>
      /(vc|virtual|cable|aux).*(1|2|\ba\b)|^(?!.*mic).*maono.*(vc|virtual)/i.test(d.label)
    );
  }

  if (lower.includes('mic')) {
    return pool.find((d) => /mic|prostudio/i.test(d.label));
  }

  if (lower.includes('hp out') || lower.includes('headphone')) {
    return pool.find((d) => /hp|headphone|earphone|speaker|maono/i.test(d.label));
  }

  // 3. Fallback fuzzy token overlap
  const tokens = lower
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && t !== 'in' && t !== 'out');
  if (tokens.length > 0) {
    const scored = pool
      .map((d) => {
        const dl = d.label.toLowerCase();
        const hits = tokens.filter((t) => dl.includes(t)).length;
        return { d, hits };
      })
      .filter((x) => x.hits >= 2)
      .sort((a, b) => b.hits - a.hits);
    if (scored[0]) return scored[0].d;
  }

  return undefined;
}
