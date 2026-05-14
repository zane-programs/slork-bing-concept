import { useEffect, useRef, useState } from "react";
import type { BeatState, DeviceInfo } from "@shared/types";
import {
  MOVEMENT_IDS,
  MOVEMENT_NAMES,
  type ClientId,
  type MovementData,
  type MovementId,
  type MovementState,
} from "../movements";
import type { BeatTick } from "./beat";
import { unlockAudio } from "./audio";
import {
  COUNTING_BPM_MAX,
  COUNTING_BPM_MIN,
  COUNTING_GAIN_MAX,
  COUNTING_GAIN_MIN,
  COUNTING_MAX_N,
  COUNTING_PITCH_SEMI_MAX,
  COUNTING_PITCH_SEMI_MIN,
  COUNTING_PRESETS,
  pitchMultiplyToSemis,
  semisToPitchMultiply,
} from "../movements/counting";
import { intensityToBpm } from "../movements/clicking";
import styles from "./conductor.module.css";

interface Props {
  state: MovementState;
  isConnected: boolean;
  clientId: ClientId | null;
  index: number | null;
  devices: DeviceInfo[];
  beat: BeatState;
  tick: BeatTick | null;
  setMovement: (movement: MovementId | null) => void;
  updateMovement: <K extends MovementId>(
    movement: K,
    data: Partial<MovementData[K]>
  ) => void;
  setBeat: (bpm: number | null) => void;
}

export function ConductorPanel({
  state,
  isConnected,
  clientId,
  index,
  devices,
  beat,
  tick,
  setMovement,
  updateMovement,
  setBeat,
}: Props) {
  return (
    <div>
      <h1>Conductor</h1>
      <p>Socket: {isConnected ? "connected" : "disconnected"}</p>
      <p>
        Your id: {clientId ?? "…"}
        {index !== null ? ` · index #${index}` : ""}
      </p>
      <p>
        Active: {state ? MOVEMENT_NAMES[state.movement] : "none"}
        {state ? null : null}
      </p>
      <div>
        {MOVEMENT_IDS.map((id) => (
          <button
            key={id}
            onClick={() => setMovement(id)}
            disabled={state?.movement === id}
          >
            {MOVEMENT_NAMES[id]}
          </button>
        ))}
        <button onClick={() => setMovement(null)} disabled={state === null}>
          Stop
        </button>
      </div>
      {state ? (
        <MovementControls
          state={state}
          beat={beat}
          updateMovement={updateMovement}
          setBeat={setBeat}
        />
      ) : null}

      <BeatControls beat={beat} setBeat={setBeat} />
      <DeviceRoster
        devices={devices}
        myClientId={clientId}
        activeClientId={tick?.activeClientId ?? null}
      />
    </div>
  );
}

function BeatControls({
  beat,
  setBeat,
}: {
  beat: BeatState;
  setBeat: (bpm: number | null) => void;
}) {
  const [bpmInput, setBpmInput] = useState(100);
  const running = beat !== null;
  return (
    <section className={styles.section}>
      <h2>Beat</h2>
      <p>Status: {running ? `running @ ${beat.bpm} bpm` : "stopped"}</p>
      <label>
        bpm:{" "}
        <input
          type="number"
          min={1}
          max={1000}
          value={bpmInput}
          onChange={(e) => setBpmInput(Number(e.target.value))}
          className={styles.bpmInput}
        />
      </label>{" "}
      <button
        onClick={() => {
          unlockAudio();
          setBeat(bpmInput);
        }}
      >
        {running ? "Apply BPM" : "Start"}
      </button>{" "}
      <button onClick={() => setBeat(null)} disabled={!running}>
        Stop
      </button>
    </section>
  );
}

function DeviceRoster({
  devices,
  myClientId,
  activeClientId,
}: {
  devices: DeviceInfo[];
  myClientId: ClientId | null;
  activeClientId: ClientId | null;
}) {
  return (
    <section className={styles.section}>
      <h2>Devices ({devices.length})</h2>
      {devices.length === 0 ? (
        <p className={styles.muted}>(none connected)</p>
      ) : (
        <ul className={styles.roster}>
          {devices.map((d) => {
            const isMe = d.clientId === myClientId;
            const isActive = d.clientId === activeClientId;
            return (
              <li
                key={d.clientId}
                className={
                  isActive
                    ? `${styles.rosterItem} ${styles.rosterItemActive}`
                    : styles.rosterItem
                }
              >
                #{d.index} - {d.clientId}
                {isMe ? " (you)" : ""}
                {isActive ? " ◀ active" : ""}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MovementControls({
  state,
  beat,
  updateMovement,
  setBeat,
}: {
  state: NonNullable<MovementState>;
  beat: BeatState;
  updateMovement: Props["updateMovement"];
  setBeat: Props["setBeat"];
}) {
  if (state.movement === "counting") {
    return (
      <CountingControls
        n={state.data.n}
        gain={state.data.gain}
        pitchMultiply={state.data.pitchMultiply}
        beat={beat}
        updateMovement={updateMovement}
        setBeat={setBeat}
      />
    );
  }
  if (state.movement === "clicking") {
    return (
      <ClickingControls
        intensity={state.data.intensity}
        updateMovement={updateMovement}
        setBeat={setBeat}
      />
    );
  }
  return null;
}

// coalesce slider scrubs per rAF; otherwise we flood the socket.
function ClickingControls({
  intensity,
  updateMovement,
  setBeat,
}: {
  intensity: number;
  updateMovement: Props["updateMovement"];
  setBeat: Props["setBeat"];
}) {
  const [localValue, setLocalValue] = useState(intensity);
  const pendingRef = useRef<number | null>(null);
  const lastSentIntensityRef = useRef(intensity);
  const lastSentBpmRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingRef.current === null) {
      setLocalValue(intensity);
      lastSentIntensityRef.current = intensity;
    }
  }, [intensity]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const flush = () => {
    rafRef.current = null;
    const v = pendingRef.current;
    pendingRef.current = null;
    if (v === null) return;
    if (v !== lastSentIntensityRef.current) {
      lastSentIntensityRef.current = v;
      updateMovement("clicking", { intensity: v });
    }
    const bpm = intensityToBpm(v);
    if (bpm !== lastSentBpmRef.current) {
      lastSentBpmRef.current = bpm;
      setBeat(bpm);
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    unlockAudio();
    const v = Number(e.target.value);
    setLocalValue(v);
    pendingRef.current = v;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  };

  const bpm = intensityToBpm(localValue);
  return (
    <div className={styles.intensityRow}>
      <label>
        Intensity:{" "}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={localValue}
          onChange={onChange}
          className={styles.intensitySlider}
        />
      </label>{" "}
      <span className={styles.intensityReadout}>
        {localValue.toFixed(2)} → {bpm} bpm
      </span>
    </div>
  );
}

function CountingControls({
  n,
  gain,
  pitchMultiply,
  beat,
  updateMovement,
  setBeat,
}: {
  n: number;
  gain: number;
  pitchMultiply: number;
  beat: BeatState;
  updateMovement: Props["updateMovement"];
  setBeat: Props["setBeat"];
}) {
  const isPreset = (COUNTING_PRESETS as readonly number[]).includes(n);
  const selectValue = isPreset ? String(n) : "custom";
  const clamp = (v: number) =>
    Math.max(1, Math.min(COUNTING_MAX_N, Math.floor(v) || 1));
  return (
    <div className={styles.countingGrid}>
      <CountingBpmSlider beat={beat} setBeat={setBeat} />
      <CountingGainSlider gain={gain} updateMovement={updateMovement} />
      <CountingPitchSlider
        pitchMultiply={pitchMultiply}
        updateMovement={updateMovement}
      />
      <div>
        <label>
          Cycle length (n):{" "}
          <select
            value={selectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") return;
              updateMovement("counting", { n: clamp(Number(v)) });
            }}
          >
            {COUNTING_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>{" "}
        <label>
          custom:{" "}
          <input
            type="number"
            min={1}
            max={COUNTING_MAX_N}
            value={n}
            onChange={(e) =>
              updateMovement("counting", { n: clamp(Number(e.target.value)) })
            }
            className={styles.customNInput}
          />
        </label>{" "}
        <span className={styles.rangeHint}>(1–{COUNTING_MAX_N})</span>
      </div>
    </div>
  );
}

function useCoalescedSlider<T>(
  serverValue: T,
  send: (v: T) => void
): {
  value: T;
  onChange: (v: T) => void;
} {
  const [localValue, setLocalValue] = useState<T>(serverValue);
  const pendingRef = useRef<{ v: T } | null>(null);
  const lastSentRef = useRef<T>(serverValue);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingRef.current === null) {
      setLocalValue(serverValue);
      lastSentRef.current = serverValue;
    }
  }, [serverValue]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const flush = () => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p === null) return;
    if (p.v !== lastSentRef.current) {
      lastSentRef.current = p.v;
      send(p.v);
    }
  };

  const onChange = (v: T) => {
    setLocalValue(v);
    pendingRef.current = { v };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  };

  return { value: localValue, onChange };
}

function CountingBpmSlider({
  beat,
  setBeat,
}: {
  beat: BeatState;
  setBeat: Props["setBeat"];
}) {
  const serverBpm = beat?.bpm ?? 100;
  const { value, onChange } = useCoalescedSlider<number>(serverBpm, (v) =>
    setBeat(v)
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>BPM</span>
      <input
        type="range"
        min={COUNTING_BPM_MIN}
        max={COUNTING_BPM_MAX}
        step={1}
        value={value}
        onChange={(e) => {
          unlockAudio();
          onChange(Number(e.target.value));
        }}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>{value} bpm</span>
    </div>
  );
}

function CountingGainSlider({
  gain,
  updateMovement,
}: {
  gain: number;
  updateMovement: Props["updateMovement"];
}) {
  const { value, onChange } = useCoalescedSlider<number>(gain, (v) =>
    updateMovement("counting", { gain: v })
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Gain</span>
      <input
        type="range"
        min={COUNTING_GAIN_MIN}
        max={COUNTING_GAIN_MAX}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>{value.toFixed(2)}×</span>
    </div>
  );
}

function CountingPitchSlider({
  pitchMultiply,
  updateMovement,
}: {
  pitchMultiply: number;
  updateMovement: Props["updateMovement"];
}) {
  const serverSemis = pitchMultiplyToSemis(pitchMultiply);
  const { value, onChange } = useCoalescedSlider<number>(serverSemis, (v) =>
    updateMovement("counting", { pitchMultiply: semisToPitchMultiply(v) })
  );
  const mult = semisToPitchMultiply(value);
  const sign = value > 0 ? "+" : "";
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Pitch</span>
      <input
        type="range"
        min={COUNTING_PITCH_SEMI_MIN}
        max={COUNTING_PITCH_SEMI_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>
        {sign}
        {value} semi ({mult.toFixed(2)}×)
      </span>
    </div>
  );
}
