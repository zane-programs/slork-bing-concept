/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
import type { MovementData } from "@shared/types";
import { useBeatSubscription } from "../lib/beat";
import { loadAudioBuffer, pickSupportedAudioUrl } from "../lib/audio";
import { truemod } from "../lib/music";
import styles from "./counting.module.css";

export { MOVEMENT_IDS, MOVEMENT_NAMES } from "@shared/movements";
export type {
  ClientId,
  MovementData,
  MovementId,
  MovementState,
} from "@shared/types";

// ffmpeg silencedetect=noise=-40dB:d=0.2 on numbers.{webm,mp3}; [startSec, durationSec] per number
// https://ffmpeg.org/ffmpeg-filters.html#silencedetect
export const NUMBER_SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  [0.786, 0.362], // 1
  [1.595, 0.415], // 2
  [2.538, 0.371], // 3
  [3.464, 0.34], // 4
  [4.336, 0.366], // 5
  [5.174, 0.379], // 6
  [6.032, 0.436], // 7
  [6.949, 0.274], // 8
  [7.786, 0.414], // 9
  [8.644, 0.351], // 10
  [9.492, 0.473], // 11
  [10.379, 0.447], // 12
  [11.337, 0.532], // 13
  [12.239, 0.48], // 14
  [13.093, 0.489], // 15
  [13.954, 0.585], // 16
  [14.891, 0.594], // 17
  [15.878, 0.505], // 18
  [16.795, 0.533], // 19
  [17.689, 0.376], // 20
];

export const COUNTING_MAX_N = NUMBER_SEGMENTS.length;

export const COUNTING_PRESETS: readonly number[] = [4, 8, 10, 12];

export const COUNTING_BPM_MIN = 40;
export const COUNTING_BPM_MAX = 300;
export const COUNTING_GAIN_MIN = 0;
export const COUNTING_GAIN_MAX = 2;
// stored pitchMultiply = 2^(semis/12)
export const COUNTING_PITCH_SEMI_MIN = -24;
export const COUNTING_PITCH_SEMI_MAX = 24;

export function semisToPitchMultiply(semis: number): number {
  return Math.pow(2, semis / 12);
}

export function pitchMultiplyToSemis(mult: number): number {
  if (!Number.isFinite(mult) || mult <= 0) return 0;
  return Math.round(12 * Math.log2(mult) * 100) / 100;
}

const NUMBERS_WEBM_URL = "/numbers.webm";
const NUMBERS_MP3_URL = "/numbers.mp3";

function deviceSpeaks(idx: number, D: number, b: number): boolean {
  if (D <= 0) return false;
  return idx === truemod(b, D);
}

// n changes apply at the next cycle boundary so we don't cut a count mid-cycle
export default function Counting({ data }: { data: MovementData["counting"] }) {
  const clampN = (v: number) =>
    Math.max(1, Math.min(COUNTING_MAX_N, Math.floor(v) || 1));

  const pendingNRef = useRef(clampN(data.n));
  const [activeN, setActiveN] = useState(() => clampN(data.n));
  const activeNRef = useRef(activeN);
  const hasTickedRef = useRef(false);

  useEffect(() => {
    pendingNRef.current = clampN(data.n);
    if (!hasTickedRef.current) {
      activeNRef.current = pendingNRef.current;
      setActiveN(pendingNRef.current);
    }
  }, [data.n]);

  const gainRef = useRef(data.gain);
  const pitchRef = useRef(data.pitchMultiply);
  useEffect(() => {
    gainRef.current = data.gain;
  }, [data.gain]);
  useEffect(() => {
    pitchRef.current = data.pitchMultiply;
  }, [data.pitchMultiply]);

  const bufferRef = useRef<AudioBuffer | null>(null);
  const loadingRef = useRef(false);
  const audioUrlRef = useRef<string>("");

  const [flashKey, setFlashKey] = useState(0);

  useBeatSubscription((e) => {
    if (truemod(e.beat, activeNRef.current) === 0) {
      if (pendingNRef.current !== activeNRef.current) {
        activeNRef.current = pendingNRef.current;
        setActiveN(pendingNRef.current);
      }
    }
    hasTickedRef.current = true;
    const n = activeNRef.current;
    if (e.myIndex === null) return;
    if (!deviceSpeaks(e.myIndex, e.deviceCount, e.beat)) return;
    const cyclePos = truemod(e.beat, n);

    if (!bufferRef.current && !loadingRef.current) {
      loadingRef.current = true;
      if (!audioUrlRef.current) {
        audioUrlRef.current = pickSupportedAudioUrl([
          { url: NUMBERS_WEBM_URL, mime: 'audio/webm; codecs="opus"' },
          { url: NUMBERS_MP3_URL, mime: "audio/mpeg" },
        ]);
      }
      loadAudioBuffer(e.ctx, audioUrlRef.current)
        .then((buf) => {
          bufferRef.current = buf;
        })
        .catch((err) => {
          console.error("counting: failed to load audio", err);
          loadingRef.current = false;
        });
    }

    const seg = NUMBER_SEGMENTS[cyclePos];
    const buf = bufferRef.current;
    if (buf) {
      playSample(e.ctx, e.audioTime, buf, {
        offsetSec: seg[0],
        durationSec: seg[1],
        gain: gainRef.current,
        playbackRate: pitchRef.current,
      });
    }

    // align flash onset with the scheduled sample
    const ctx = e.ctx;
    const fire = () => setFlashKey((k) => k + 1);
    const delayMs = Math.max(0, (e.audioTime - ctx.currentTime) * 1000);
    if (delayMs < 4) {
      fire();
    } else {
      setTimeout(fire, delayMs);
    }
  });

  const pending = clampN(data.n) !== activeN ? clampN(data.n) : null;
  return <CountingStage flashKey={flashKey} n={activeN} pendingN={pending} />;
}

function CountingStage({
  flashKey,
  n,
  pendingN,
}: {
  flashKey: number;
  n: number;
  pendingN: number | null;
}) {
  return (
    <>
      <div className={styles.blackdrop} aria-hidden />
      <div
        key={flashKey}
        // skip animation on mount
        className={
          flashKey > 0
            ? `${styles.flash} ${styles.flashAnimating}`
            : styles.flash
        }
        aria-hidden
      />
    </>
  );
}
