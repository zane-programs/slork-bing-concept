import { useEffect, useRef, useState } from "react";
import type { MovementData } from "@shared/types";
import { useBeatSubscription } from "../lib/beat";
import { midiToFreq, parseNoteToMidi } from "../lib/music";
import styles from "./wake.module.css";
import clsx from "clsx";

export { MOVEMENT_IDS, MOVEMENT_NAMES } from "@shared/movements";
export type {
  ClientId,
  MovementData,
  MovementId,
  MovementState,
} from "@shared/types";

export const WAKE_BPM_MIN = 20;
export const WAKE_BPM_MAX = 240;
export const WAKE_GAIN_MIN = 0;
export const WAKE_GAIN_MAX = 1;

// Dsus2sus4? am not the music theory guy of all time
const WAKE_PITCH_NAMES = [
  "D3",
  "E3",
  "G3",
  "A3",
  "D4",
  "E4",
  "G4",
  "A4",
  "D5",
  "E5",
  "G5",
  "A5",
  "D6",
  "E6",
  "G6",
  "A6",
] as const;

const WAKE_PITCH_FREQS: readonly number[] = WAKE_PITCH_NAMES.map((n) => {
  const midi = parseNoteToMidi(n);
  if (midi === null) throw new Error(`wake: bad pitch ${n}`);
  return midiToFreq(midi);
});

const HUES_BY_PC: Record<number, number> = {
  2: 200, // D = cool blue
  4: 320, // E = magenta
  7: 110, // G = green
  9: 35, // A = amber
};

const NOTE_MIN_SEC = 0.8;
const NOTE_MAX_SEC = 3.5;
// randomize spread of note onsets to give a stochastic wash of
// notes rather than something more rigid - that's why i named this
// movement wake, it's like slowly, imperfectly, but beautifully waking up!
const ONSET_SPREAD_BEATS = 1.6;
// occasionally drop a beat so density wobbles instead of being uniform
// to quote cs 109 i am taking right now, Skip ~ Bern(0.18)
const SKIP_PROB = 0.18;

// for procedural generation of notes (tacking these on to activeNoteNames names)
const POSSIBLE_OCTAVES = [3, 4, 5, 6];

function pickPitch(pitchesBank: Set<number> = new Set(WAKE_PITCH_FREQS)): {
  freq: number;
  hue: number;
} {
  console.log("picking from bank", pitchesBank.size, pitchesBank);
  const i = Math.floor(Math.random() * pitchesBank.size);
  const freq = Array.from(pitchesBank)[i];
  const pc = [2, 4, 7, 9][i % 4];
  return { freq, hue: HUES_BY_PC[pc] };
}

function convertNoteNamesToPitches(noteNames: readonly string[]): Set<number> {
  const pitches = new Set<number>();
  for (const n of noteNames) {
    for (const octave of POSSIBLE_OCTAVES) {
      // e.g. n = "D", octave = 4 => note = "D4"
      const note = n + octave;
      const midi = parseNoteToMidi(note);
      if (midi !== null) pitches.add(midiToFreq(midi));
    }
  }
  return pitches;
}

// soft, bellish tone with a long fade so notes overlap into a wash
function playWakeNote(
  ctx: AudioContext,
  audioTime: number,
  freq: number,
  gainVal: number,
  noteSec: number
) {
  const t = Math.max(audioTime, ctx.currentTime);
  const attackSec = Math.min(0.08, noteSec * 0.15);
  const releaseSec = Math.max(0.3, noteSec - attackSec);
  // soft per-note velocity variation
  const velocity = 0.55 + Math.random() * 0.45;
  const peakGain = Math.max(0.0001, gainVal * 0.55 * velocity);
  const noteEnd = t + attackSec + releaseSec;

  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  // sine + triangle is bellish i suppose
  osc.type = "sine";
  osc2.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);
  osc2.frequency.setValueAtTime(freq * 2, t);
  const partial = ctx.createGain();
  partial.gain.value = 0.16;
  osc2.connect(partial);
  osc.connect(gain);
  partial.connect(gain);
  gain.connect(ctx.destination);

  // https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/exponentialRampToValueAtTime
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peakGain, t + attackSec);
  gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

  osc.start(t);
  osc2.start(t);
  osc.stop(noteEnd + 0.02);
  osc2.stop(noteEnd + 0.02);
}

interface Flash {
  key: number;
  hue: number;
  durationMs: number;
}

export default function Wake({ data }: { data: MovementData["wake"] }) {
  const gainRef = useRef(data.gain);
  const pitchesBankRef = useRef(new Set<number>());

  useEffect(() => {
    gainRef.current = data.gain;
  }, [data.gain]);
  useEffect(() => {
    // separated this into its own effect bc convertNoteNamesToPitches is a bit expensive
    // TODO: consider converting to pitches on conductor side, saving all phones from having
    // to do this themselves (might be kinder of me lol)
    if (data.activeNoteNames?.length === 0) {
      pitchesBankRef.current = new Set<number>();
    } else {
      pitchesBankRef.current = convertNoteNamesToPitches(data.activeNoteNames);
    }
  }, [data.activeNoteNames]);

  const [flashes, setFlashes] = useState<readonly Flash[]>([]);
  const flashKeyRef = useRef(0);
  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );

  useEffect(() => {
    const pending = pendingTimeoutsRef.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  useBeatSubscription((e) => {
    if (gainRef.current <= 0 || pitchesBankRef.current.size === 0) return;
    if (Math.random() < SKIP_PROB) return;

    const { freq, hue } = pickPitch(pitchesBankRef.current);
    const period = Math.max(0.15, e.periodSec);
    // random onset within ~1.6 beats so devices smear across the grid
    const onsetOffsetSec = Math.random() * (period * ONSET_SPREAD_BEATS);
    const noteSec = Math.min(
      NOTE_MAX_SEC,
      NOTE_MIN_SEC + Math.random() * Math.max(NOTE_MIN_SEC, period * 2.5)
    );
    const onsetAudio = e.audioTime + onsetOffsetSec;
    playWakeNote(e.ctx, onsetAudio, freq, gainRef.current, noteSec);

    const ctx = e.ctx;
    const delayMs = Math.max(0, (onsetAudio - ctx.currentTime) * 1000);
    const durationMs = noteSec * 1000;

    const fire = () => {
      const key = ++flashKeyRef.current;
      const f: Flash = { key, hue, durationMs };
      setFlashes((prev) => [...prev, f]);
      const cleanup = setTimeout(() => {
        pendingTimeoutsRef.current.delete(cleanup);
        setFlashes((prev) => prev.filter((x) => x.key !== key));
      }, durationMs + 30);
      pendingTimeoutsRef.current.add(cleanup);
    };

    if (delayMs < 4) {
      fire();
    } else {
      const onsetTimer = setTimeout(() => {
        pendingTimeoutsRef.current.delete(onsetTimer);
        fire();
      }, delayMs);
      pendingTimeoutsRef.current.add(onsetTimer);
    }
  });

  return (
    <>
      <div className={styles.blackdrop} aria-hidden />
      {flashes.map((f) => (
        <div
          key={f.key}
          className={clsx(styles.flash, styles.flashAnimating)}
          style={{
            background: `radial-gradient(circle at 50% 50%, hsl(${f.hue}, 90%, 55%), #000 78%)`,
            animationDuration: `${f.durationMs}ms`,
          }}
          aria-hidden
        />
      ))}
    </>
  );
}
