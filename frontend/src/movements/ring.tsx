import { useEffect, useRef, useState } from "react";
import type { DeviceKind, MovementData } from "@shared/types";
import { loadAudioBuffer, unlockAudio } from "../lib/audio";
import styles from "./ring.module.css";

export const RING_GAIN_MIN = 0;
export const RING_GAIN_MAX = 1;
export const RING_NOISE_MIN = 0;
export const RING_NOISE_MAX = 1;

// served statically out of public/ringtones/
const RINGTONE_URLS = [
  "/ringtones/by-the-seaside.mp3",
  "/ringtones/crystals.mp3",
  "/ringtones/marimba.mp3",
  "/ringtones/old-phone.mp3",
  "/ringtones/opening.mp3",
  "/ringtones/piano-riff.mp3",
  "/ringtones/reflection.mp3",
] as const;

const NOISE_BUFFER_SEC = 2;
const PARAM_SMOOTH_SEC = 0.05;

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SEC);
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // noise from uniform-random samples ~ Uni(-1,1)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface AudioGraph {
  ctx: AudioContext;
  ringBus: GainNode;
  noiseBus: GainNode;
  noiseSrc: AudioBufferSourceNode;
}

interface Props {
  data: MovementData["ring"];
  deviceKind?: DeviceKind | null;
}

export default function Ring({ data, deviceKind }: Props) {
  const isMember = deviceKind === "member";

  const graphRef = useRef<AudioGraph | null>(null);
  const buffersRef = useRef<AudioBuffer[]>([]);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const [ready, setReady] = useState(false);
  const [tapCount, setTapCount] = useState(0);

  const initialGainRef = useRef(data.gain);
  const initialNoiseRef = useRef(data.noise);

  useEffect(() => {
    if (!isMember) return;
    const ctx = unlockAudio();
    if (!ctx) return;

    const ringBus = ctx.createGain();
    const noiseBus = ctx.createGain();
    ringBus.gain.value = (1 - initialNoiseRef.current) * initialGainRef.current;
    noiseBus.gain.value = initialNoiseRef.current * initialGainRef.current;
    ringBus.connect(ctx.destination);
    noiseBus.connect(ctx.destination);

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = makeNoiseBuffer(ctx);
    noiseSrc.loop = true;
    noiseSrc.connect(noiseBus);
    noiseSrc.start();

    graphRef.current = { ctx, ringBus, noiseBus, noiseSrc };
    const activeSources = activeSourcesRef.current;

    let cancelled = false;
    Promise.all(RINGTONE_URLS.map((u) => loadAudioBuffer(ctx, u)))
      .then((bufs) => {
        if (cancelled) return;
        buffersRef.current = bufs;
        setReady(true);
      })
      .catch((err) => console.error("ring: preload failed", err));

    return () => {
      cancelled = true;
      const g = graphRef.current;
      graphRef.current = null;
      if (!g) return;
      try {
        g.noiseSrc.stop();
      } catch {
        // ok if already stopped
      }
      g.noiseSrc.disconnect();
      g.noiseBus.disconnect();
      for (const s of activeSources) {
        try {
          s.stop();
        } catch {
          // ok if already finished
        }
        s.disconnect();
      }
      activeSources.clear();
      g.ringBus.disconnect();
    };
  }, [isMember]);

  // re-smooth bus gains when the conductor moves the sliders
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const now = g.ctx.currentTime;
    g.ringBus.gain.setTargetAtTime(
      (1 - data.noise) * data.gain,
      now,
      PARAM_SMOOTH_SEC,
    );
    g.noiseBus.gain.setTargetAtTime(
      data.noise * data.gain,
      now,
      PARAM_SMOOTH_SEC,
    );
  }, [data.gain, data.noise]);

  const handleTap = () => {
    if (!isMember) return;
    const g = graphRef.current;
    const bufs = buffersRef.current;
    if (!g || bufs.length === 0) return;
    // in case we lost audio permissions if the user backgrounded
    unlockAudio();

    const buf = bufs[Math.floor(Math.random() * bufs.length)];
    const src = g.ctx.createBufferSource();
    src.buffer = buf;
    // play twice: loop=true with stop(t + 2*duration)
    src.loop = true;
    src.connect(g.ringBus);
    const startAt = g.ctx.currentTime;
    src.start(startAt);
    src.stop(startAt + buf.duration * 2);
    activeSourcesRef.current.add(src);
    src.onended = () => {
      activeSourcesRef.current.delete(src);
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
    };
    setTapCount((c) => c + 1);
  };

  if (!isMember) {
    return <div className={styles.blackdrop} aria-hidden />;
  }

  return (
    <div className={styles.surface} onPointerDown={handleTap}>
      <div className={styles.blackdrop} aria-hidden />
      <div className={styles.message}>
        <p className={styles.headline}>{ready ? "Tap to ring" : "Loading"}</p>
        <p className={styles.subtle}>taps: {tapCount}</p>
      </div>
    </div>
  );
}
