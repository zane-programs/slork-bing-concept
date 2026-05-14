/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
import type { MovementData } from "@shared/types";
import { useBeatSubscription } from "../lib/beat";
import styles from "./clicking.module.css";

export const CLICKING_BPM_MIN = 60;
export const CLICKING_BPM_MAX = 1000;

const CLICK_DUR_SEC = 0.04;

export function intensityToBpm(intensity: number): number {
  const clamped = Math.max(0, Math.min(1, intensity));
  return Math.round(
    CLICKING_BPM_MIN + clamped * (CLICKING_BPM_MAX - CLICKING_BPM_MIN),
  );
}

function playClick(ctx: AudioContext, audioTime: number, intensity: number) {
  const t = Math.max(audioTime, ctx.currentTime);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1800 + intensity * 400, t);
  osc.connect(gain).connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.6, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + CLICK_DUR_SEC);
  osc.start(t);
  osc.stop(t + CLICK_DUR_SEC + 0.01);
}

function randomColor(): string {
  const h = Math.floor(Math.random() * 360);
  return `hsl(${h}, 100%, 55%)`;
}

export default function Clicking({ data }: { data: MovementData["clicking"] }) {
  const intensityRef = useRef(data.intensity);
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const offTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    intensityRef.current = data.intensity;
  }, [data.intensity]);

  useEffect(() => {
    return () => {
      if (offTimerRef.current !== null) clearTimeout(offTimerRef.current);
    };
  }, []);

  useBeatSubscription((e) => {
    if (!e.isMine) return;
    playClick(e.ctx, e.audioTime, intensityRef.current);

    const ctx = e.ctx;
    const color = randomColor();
    const onMs = Math.max(0, (e.audioTime - ctx.currentTime) * 1000);

    const turnOn = () => {
      setFlashColor(color);
      if (offTimerRef.current !== null) clearTimeout(offTimerRef.current);
      offTimerRef.current = setTimeout(() => {
        setFlashColor(null);
        offTimerRef.current = null;
      }, CLICK_DUR_SEC * 1000);
    };

    if (onMs < 4) {
      turnOn();
    } else {
      setTimeout(turnOn, onMs);
    }
  });

  return (
    <>
      <div className={styles.blackdrop} aria-hidden />
      {flashColor !== null && (
        <div
          className={styles.flash}
          style={{ background: flashColor }}
          aria-hidden
        />
      )}
    </>
  );
}
