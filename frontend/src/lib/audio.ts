// https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices#autoplay_policy
let ctx: AudioContext | null = null;

type AudioCtor = typeof AudioContext;
interface AudioWindow extends Window {
  webkitAudioContext?: AudioCtor;
}

export function unlockAudio(): AudioContext | null {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  if (typeof window === "undefined") return null;
  const w = window as AudioWindow;
  const Ctor: AudioCtor | undefined =
    window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function getAudioCtx(): AudioContext | null {
  return ctx;
}

export function isAudioUnlocked(): boolean {
  return ctx !== null && ctx.state === "running";
}

export interface ToneOpts {
  type?: OscillatorType;
  attackSec?: number;
  releaseSec?: number;
  peakGain?: number;
}

export function playTone(
  ctx: AudioContext,
  audioTime: number,
  freq: number,
  durSec: number,
  opts: ToneOpts = {}
) {
  const t = Math.max(audioTime, ctx.currentTime);
  const type = opts.type ?? "sine";
  const attackSec = opts.attackSec ?? 0.005;
  const releaseSec = opts.releaseSec ?? 0.1;
  const peakGain = opts.peakGain ?? 0.25;
  const sustainEnd = t + Math.max(attackSec, durSec - releaseSec);
  const noteEnd = t + Math.max(durSec, attackSec + 0.01);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.connect(gain).connect(ctx.destination);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peakGain, t + attackSec);
  gain.gain.setValueAtTime(peakGain, sustainEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

  osc.start(t);
  osc.stop(noteEnd + 0.02);
}

const bufferCache = new WeakMap<
  AudioContext,
  Map<string, Promise<AudioBuffer>>
>();

export function loadAudioBuffer(
  ctx: AudioContext,
  url: string
): Promise<AudioBuffer> {
  let perCtx = bufferCache.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    bufferCache.set(ctx, perCtx);
  }
  const existing = perCtx.get(url);
  if (existing) return existing;
  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`audio fetch ${url}: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => ctx.decodeAudioData(buf));
  perCtx.set(url, p);
  p.catch(() => perCtx!.delete(url));
  return p;
}

export function pickSupportedAudioUrl(
  candidates: ReadonlyArray<{ url: string; mime: string }>
): string {
  if (typeof document === "undefined")
    return candidates[candidates.length - 1].url;
  const probe = document.createElement("audio");
  for (const c of candidates) {
    if (probe.canPlayType(c.mime)) return c.url;
  }
  return candidates[candidates.length - 1].url;
}

export interface SampleOpts {
  offsetSec?: number;
  durationSec?: number;
  gain?: number;
  releaseSec?: number;
  playbackRate?: number;
}

export function playSample(
  ctx: AudioContext,
  audioTime: number,
  buffer: AudioBuffer,
  opts: SampleOpts = {}
): void {
  const t = Math.max(audioTime, ctx.currentTime);
  const offsetSec = Math.max(0, opts.offsetSec ?? 0);
  const remaining = Math.max(0, buffer.duration - offsetSec);
  const durationSec = Math.min(opts.durationSec ?? remaining, remaining);
  if (durationSec <= 0) return;
  const gainVal = opts.gain ?? 1;
  const playbackRate = Math.max(0.01, opts.playbackRate ?? 1);
  const outDurSec = durationSec / playbackRate;
  const releaseSec = Math.min(opts.releaseSec ?? 0.02, outDurSec);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = playbackRate;
  const gain = ctx.createGain();
  src.connect(gain).connect(ctx.destination);

  gain.gain.setValueAtTime(gainVal, t);
  gain.gain.setValueAtTime(gainVal, t + outDurSec - releaseSec);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + outDurSec);

  src.start(t, offsetSec, durationSec);
  src.stop(t + outDurSec + 0.02);
}
