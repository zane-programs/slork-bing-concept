import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MovementData } from "@shared/types";
import { unlockAudio } from "../lib/audio";
import { NOTE_TO_PC, midiToFreq, parseNoteToMidi } from "../lib/music";
import { getOrientationRefs } from "../lib/orientation";
import styles from "./turn.module.css";

// listener owned by lib/orientation.ts, attached during landing/join
const { betaRef: orientationBetaRef, gammaRef: orientationGammaRef } =
  getOrientationRefs();

export const TURN_GAIN_MIN = 0;
export const TURN_GAIN_MAX = 1;
export const TURN_OCTAVE_MIN = 2;
export const TURN_OCTAVE_MAX = 6;
export const TURN_VIBRATO_CENTS_MIN = 0;
export const TURN_VIBRATO_CENTS_MAX = 100;
export const TURN_TIMBRE_AMOUNT_MIN = 0;
export const TURN_TIMBRE_AMOUNT_MAX = 1;

// hues match wake where notes overlap; filler hues round out the wheel
const HUE_BY_PC: Record<number, number> = {
  0: 0,
  1: 20,
  2: 200,
  3: 240,
  4: 320,
  5: 280,
  6: 260,
  7: 110,
  8: 80,
  9: 35,
  10: 50,
  11: 350,
};

const VIBRATO_RATE_HZ = 6;
const TIMBRE_BASE_HZ = 2200;
const TIMBRE_MIN_HZ = 250;
const TIMBRE_MAX_HZ = 14000;

const ATTACK_SEC = 0.04;
const RELEASE_SEC = 0.25;
const PARAM_SMOOTH_SEC = 0.05;

const MAX_VOICES = 4;

// must match the css ripple animation duration
const RIPPLE_LIFE_MS = 900;

interface Voice {
  pointerId: number;
  noteKey: string;
  carrier: OscillatorNode;
  lfo: OscillatorNode;
  lfoDepth: GainNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  releasing: boolean;
}

interface PaletteNote {
  noteName: string;
  octave: number;
  midi: number;
  freq: number;
  hue: number;
  key: string;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
  hue: number;
}

interface ActiveTouch {
  x: number;
  y: number;
  hue: number;
}

// sorted, deduped palette so y-position has a stable mapping to note
function buildPalette(
  pitchClasses: readonly string[],
  octave: number
): PaletteNote[] {
  const seen = new Set<string>();
  const valid: { pc: string; idx: number }[] = [];
  for (const pc of pitchClasses) {
    if (seen.has(pc)) continue;
    const idx = NOTE_TO_PC[pc];
    if (idx === undefined) continue;
    seen.add(pc);
    valid.push({ pc, idx });
  }
  valid.sort((a, b) => a.idx - b.idx);
  const out: PaletteNote[] = [];
  for (const { pc, idx } of valid) {
    const midi = parseNoteToMidi(`${pc}${octave}`);
    if (midi === null) continue;
    out.push({
      noteName: pc,
      octave,
      midi,
      freq: midiToFreq(midi),
      hue: HUE_BY_PC[idx] ?? 0,
      key: `${pc}${octave}`,
    });
  }
  return out;
}

// top of screen = highest note, bottom = lowest; snaps y into equal bands
function yToPaletteIndex(y: number, height: number, count: number): number {
  if (count <= 0 || height <= 0) return -1;
  const band = height / count;
  const fromBottom = height - y;
  let i = Math.floor(fromBottom / band);
  if (i < 0) i = 0;
  if (i > count - 1) i = count - 1;
  return i;
}

function makeVoice(
  ctx: AudioContext,
  destination: AudioNode,
  note: PaletteNote,
  pointerId: number,
  initialDepthCents: number,
  initialCutoffHz: number
): Voice {
  const t = ctx.currentTime;
  const carrier = ctx.createOscillator();
  carrier.type = "triangle";
  carrier.frequency.setValueAtTime(note.freq, t);

  // lfo -> depth gain -> carrier.detune (cents)
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.setValueAtTime(VIBRATO_RATE_HZ, t);
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.setValueAtTime(initialDepthCents, t);
  lfo.connect(lfoDepth).connect(carrier.detune);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(initialCutoffHz, t);
  filter.Q.setValueAtTime(0.7, t);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.22, t + ATTACK_SEC);

  carrier.connect(filter).connect(gain).connect(destination);

  carrier.start(t);
  lfo.start(t);

  return {
    pointerId,
    noteKey: note.key,
    carrier,
    lfo,
    lfoDepth,
    filter,
    gain,
    releasing: false,
  };
}

function releaseVoice(ctx: AudioContext, v: Voice) {
  if (v.releasing) return;
  v.releasing = true;
  const t = ctx.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  // anchor at current value before the ramp; chrome glitches on canceled ramps otherwise
  const current = Math.max(v.gain.gain.value, 0.0001);
  v.gain.gain.setValueAtTime(current, t);
  v.gain.gain.exponentialRampToValueAtTime(0.0001, t + RELEASE_SEC);
  v.carrier.stop(t + RELEASE_SEC + 0.05);
  v.lfo.stop(t + RELEASE_SEC + 0.05);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// right tilt = brighter, left = duller; amount=1 with |gamma|=60deg gives ~4x cutoff
function gammaToCutoff(gamma: number, timbreAmount: number): number {
  const g = clamp(gamma, -90, 90);
  const t = clamp(timbreAmount, 0, 1);
  const exp = (t * g) / 30;
  const cutoff = TIMBRE_BASE_HZ * Math.pow(2, exp);
  return clamp(cutoff, TIMBRE_MIN_HZ, TIMBRE_MAX_HZ);
}

// either direction of tilt gives vibrato; capped at 60deg
function betaToDepthScalar(beta: number): number {
  const b = clamp(Math.abs(beta), 0, 60);
  return b / 60;
}

export default function Turn({ data }: { data: MovementData["turn"] }) {
  const [activeTouches, setActiveTouches] = useState<Map<number, ActiveTouch>>(
    () => new Map()
  );
  const [ripples, setRipples] = useState<readonly Ripple[]>([]);
  const rippleIdRef = useRef(0);
  const ripplePendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );

  // mirror conductor params so live voices can read without re-creating
  const gainRef = useRef(data.gain);
  const vibratoMaxCentsRef = useRef(data.vibratoMaxCents);
  const timbreAmountRef = useRef(data.timbreAmount);

  useEffect(() => {
    gainRef.current = clamp(data.gain, TURN_GAIN_MIN, TURN_GAIN_MAX);
  }, [data.gain]);
  useEffect(() => {
    vibratoMaxCentsRef.current = clamp(
      data.vibratoMaxCents,
      TURN_VIBRATO_CENTS_MIN,
      TURN_VIBRATO_CENTS_MAX
    );
  }, [data.vibratoMaxCents]);
  useEffect(() => {
    timbreAmountRef.current = clamp(
      data.timbreAmount,
      TURN_TIMBRE_AMOUNT_MIN,
      TURN_TIMBRE_AMOUNT_MAX
    );
  }, [data.timbreAmount]);

  const palette = useMemo(
    () => buildPalette(data.activeNoteNames, data.octave),
    [data.activeNoteNames, data.octave]
  );
  const paletteRef = useRef(palette);
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  // shared output gain so all voices scale by conductor gain without touching envelopes
  const outBusRef = useRef<{ ctx: AudioContext; node: GainNode } | null>(null);
  const voicesRef = useRef<Map<number, Voice>>(new Map());
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const ensureOutBus = useCallback((): {
    ctx: AudioContext;
    node: GainNode;
  } | null => {
    if (outBusRef.current) {
      outBusRef.current.node.gain.setTargetAtTime(
        gainRef.current,
        outBusRef.current.ctx.currentTime,
        PARAM_SMOOTH_SEC
      );
      return outBusRef.current;
    }
    const ctx = unlockAudio();
    if (!ctx) return null;
    const node = ctx.createGain();
    node.gain.setValueAtTime(gainRef.current, ctx.currentTime);
    node.connect(ctx.destination);
    outBusRef.current = { ctx, node };
    return outBusRef.current;
  }, []);

  // track conductor gain updates even when no new voices are being created
  useEffect(() => {
    const bus = outBusRef.current;
    if (!bus) return;
    bus.node.gain.setTargetAtTime(
      gainRef.current,
      bus.ctx.currentTime,
      PARAM_SMOOTH_SEC
    );
  }, [data.gain]);

  // rAF ticker smooths device events and prevents ramp queueing
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const bus = outBusRef.current;
      const voices = voicesRef.current;
      if (bus && voices.size > 0) {
        const now = bus.ctx.currentTime;
        const depth =
          betaToDepthScalar(orientationBetaRef.current) *
          vibratoMaxCentsRef.current;
        const cutoff = gammaToCutoff(
          orientationGammaRef.current,
          timbreAmountRef.current
        );
        for (const v of voices.values()) {
          v.lfoDepth.gain.setTargetAtTime(depth, now, PARAM_SMOOTH_SEC);
          v.filter.frequency.setTargetAtTime(cutoff, now, PARAM_SMOOTH_SEC);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // kill voices whose note dropped out of the palette
  useEffect(() => {
    const bus = outBusRef.current;
    if (!bus) return;
    const voices = voicesRef.current;
    const liveKeys = new Set(palette.map((p) => p.key));
    const stale: number[] = [];
    for (const [pid, v] of voices) {
      if (!liveKeys.has(v.noteKey)) {
        releaseVoice(bus.ctx, v);
        stale.push(pid);
      }
    }
    if (stale.length > 0) {
      setTimeout(() => {
        for (const pid of stale) voices.delete(pid);
      }, (RELEASE_SEC + 0.1) * 1000);
      setActiveTouches((prev) => {
        if (stale.every((pid) => !prev.has(pid))) return prev;
        const next = new Map(prev);
        for (const pid of stale) next.delete(pid);
        return next;
      });
    }
  }, [palette]);

  // cleanup oscillators and ripple timers on unmount
  useEffect(() => {
    const voices = voicesRef.current;
    const pendingTimeouts = ripplePendingTimeoutsRef.current;
    return () => {
      const bus = outBusRef.current;
      if (bus) {
        for (const v of voices.values()) releaseVoice(bus.ctx, v);
      }
      voices.clear();
      for (const t of pendingTimeouts) clearTimeout(t);
      pendingTimeouts.clear();
    };
  }, []);

  const spawnRipple = useCallback((x: number, y: number, hue: number) => {
    const id = ++rippleIdRef.current;
    setRipples((prev) => [...prev, { id, x, y, hue }]);
    const handle = setTimeout(() => {
      ripplePendingTimeoutsRef.current.delete(handle);
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, RIPPLE_LIFE_MS);
    ripplePendingTimeoutsRef.current.add(handle);
  }, []);

  const startTouch = useCallback(
    (pointerId: number, clientX: number, clientY: number) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const pal = paletteRef.current;
      const idx = yToPaletteIndex(localY, rect.height, pal.length);
      if (idx < 0) return;
      const note = pal[idx];

      const bus = ensureOutBus();
      if (!bus) return;
      const voices = voicesRef.current;
      if (voices.size >= MAX_VOICES) {
        let victim: Voice | null = null;
        for (const v of voices.values()) {
          if (v.releasing) {
            victim = v;
            break;
          }
        }
        if (!victim) victim = voices.values().next().value ?? null;
        if (victim) {
          releaseVoice(bus.ctx, victim);
          voices.delete(victim.pointerId);
          setActiveTouches((prev) => {
            if (!prev.has(victim!.pointerId)) return prev;
            const next = new Map(prev);
            next.delete(victim!.pointerId);
            return next;
          });
        }
      }

      const depth =
        betaToDepthScalar(orientationBetaRef.current) *
        vibratoMaxCentsRef.current;
      const cutoff = gammaToCutoff(
        orientationGammaRef.current,
        timbreAmountRef.current
      );
      const voice = makeVoice(
        bus.ctx,
        bus.node,
        note,
        pointerId,
        depth,
        cutoff
      );
      voices.set(pointerId, voice);
      setActiveTouches((prev) => {
        const next = new Map(prev);
        next.set(pointerId, { x: localX, y: localY, hue: note.hue });
        return next;
      });
      spawnRipple(localX, localY, note.hue);
    },
    [ensureOutBus, spawnRipple]
  );

  const moveTouch = useCallback(
    (pointerId: number, clientX: number, clientY: number) => {
      const voices = voicesRef.current;
      const voice = voices.get(pointerId);
      if (!voice || voice.releasing) return;
      const surface = surfaceRef.current;
      const bus = outBusRef.current;
      if (!surface || !bus) return;
      const rect = surface.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const pal = paletteRef.current;
      const idx = yToPaletteIndex(localY, rect.height, pal.length);
      if (idx < 0) return;
      const note = pal[idx];

      setActiveTouches((prev) => {
        const cur = prev.get(pointerId);
        if (
          cur &&
          cur.x === localX &&
          cur.y === localY &&
          cur.hue === note.hue
        ) {
          return prev;
        }
        const next = new Map(prev);
        next.set(pointerId, { x: localX, y: localY, hue: note.hue });
        return next;
      });

      // only re-pitch when the band changed, otherwise slow drags queue ramps
      if (voice.noteKey === note.key) return;
      voice.noteKey = note.key;
      const t = bus.ctx.currentTime;
      voice.carrier.frequency.cancelScheduledValues(t);
      // short portamento avoids clicks on band transitions
      voice.carrier.frequency.setTargetAtTime(note.freq, t, 0.015);
      spawnRipple(localX, localY, note.hue);
    },
    [spawnRipple]
  );

  const endTouch = useCallback((pointerId: number) => {
    const bus = outBusRef.current;
    const voices = voicesRef.current;
    const voice = voices.get(pointerId);
    if (voice && bus) {
      releaseVoice(bus.ctx, voice);
      voices.delete(pointerId);
    } else if (voice) {
      voices.delete(pointerId);
    }
    setActiveTouches((prev) => {
      if (!prev.has(pointerId)) return prev;
      const next = new Map(prev);
      next.delete(pointerId);
      return next;
    });
  }, []);

  const noNotes = palette.length === 0;

  return (
    <div className={styles.blackdrop}>
      <div
        ref={surfaceRef}
        className={styles.surface}
        onPointerDown={(e) => {
          if (noNotes) return;
          e.preventDefault();
          // capture so swipes don't drop pointer events
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          startTouch(e.pointerId, e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (noNotes) return;
          if (!voicesRef.current.has(e.pointerId)) return;
          moveTouch(e.pointerId, e.clientX, e.clientY);
        }}
        onPointerUp={(e) => endTouch(e.pointerId)}
        onPointerCancel={(e) => endTouch(e.pointerId)}
        // mouse-only edge case; touch stays captured until up/cancel
        onPointerLeave={(e) => {
          if (!(e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) {
            endTouch(e.pointerId);
          }
        }}
      >
        {Array.from(activeTouches.entries()).map(([pid, t]) => (
          <div
            key={`touch-${pid}`}
            className={styles.touchGlow}
            style={{
              left: t.x,
              top: t.y,
              background: `radial-gradient(circle, hsla(${t.hue}, 95%, 65%, 0.55), hsla(${t.hue}, 90%, 45%, 0) 70%)`,
            }}
            aria-hidden
          />
        ))}
        {ripples.map((r) => (
          <div
            key={`ripple-${r.id}`}
            className={styles.ripple}
            style={{
              left: r.x,
              top: r.y,
              borderColor: `hsl(${r.hue}, 95%, 65%)`,
              boxShadow: `0 0 32px 4px hsla(${r.hue}, 95%, 65%, 0.55)`,
              animationDuration: `${RIPPLE_LIFE_MS}ms`,
            }}
            aria-hidden
          />
        ))}
        {!noNotes && (
          <ul className={styles.noteRuler} aria-hidden>
            {palette
              .slice()
              .reverse()
              .map((n) => (
                <li key={n.key}>{n.noteName}</li>
              ))}
          </ul>
        )}
        {noNotes && (
          <div className={styles.message}>
            <p>Waiting for the conductor…</p>
            <p className={styles.subtle}>(no notes in the palette yet)</p>
          </div>
        )}
      </div>
    </div>
  );
}
