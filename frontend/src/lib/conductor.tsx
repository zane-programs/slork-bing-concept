import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type {
  BeatState,
  DeviceInfo,
  EnabledKinds,
  ToggleKind,
} from "@shared/types";
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
import {
  CLICKING_GAIN_MAX,
  CLICKING_GAIN_MIN,
  intensityToBpm,
} from "../movements/clicking";
import {
  WAKE_BPM_MAX,
  WAKE_BPM_MIN,
  WAKE_GAIN_MAX,
  WAKE_GAIN_MIN,
} from "../movements/wake";
import {
  TURN_GAIN_MAX,
  TURN_GAIN_MIN,
  TURN_OCTAVE_MAX,
  TURN_OCTAVE_MIN,
  TURN_TIMBRE_AMOUNT_MAX,
  TURN_TIMBRE_AMOUNT_MIN,
  TURN_VIBRATO_CENTS_MAX,
  TURN_VIBRATO_CENTS_MIN,
} from "../movements/turn";
import {
  RING_GAIN_MAX,
  RING_GAIN_MIN,
  RING_NOISE_MAX,
  RING_NOISE_MIN,
} from "../movements/ring";
import styles from "./conductor.module.css";

interface Props {
  state: MovementState;
  isConnected: boolean;
  isBridgeConnected: boolean;
  clientId: ClientId | null;
  index: number | null;
  devices: DeviceInfo[];
  beat: BeatState;
  tick: BeatTick | null;
  enabledKinds: EnabledKinds;
  setMovement: (movement: MovementId | null) => void;
  updateMovement: <K extends MovementId>(
    movement: K,
    data: Partial<MovementData[K]>,
  ) => void;
  setBeat: (bpm: number | null) => void;
  setEnabledKinds: (enabled: EnabledKinds) => void;
}

export function ConductorPanel({
  state,
  isConnected,
  isBridgeConnected,
  clientId,
  index,
  devices,
  beat,
  tick,
  enabledKinds,
  setMovement,
  updateMovement,
  setBeat,
  setEnabledKinds,
}: Props) {
  return (
    <div>
      <h1>Conductor</h1>
      <p>
        Cloud: {isConnected ? "connected" : "disconnected"}
        <br />
        Bridge: {isBridgeConnected ? "connected" : "disconnected"}
      </p>
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
      <EnabledKindsControls
        enabledKinds={enabledKinds}
        setEnabledKinds={setEnabledKinds}
      />
      <DeviceRoster
        devices={devices}
        myClientId={clientId}
        activeClientId={tick?.activeClientId ?? null}
      />
    </div>
  );
}

type KindsMode = "live" | "staging";

const KIND_LABELS: Record<ToggleKind, string> = {
  audience: "Audience phones",
  member: "SLOrk phones (members)",
  slorkstation: "SLOrkstations (OSC)",
};

const KIND_ORDER: ToggleKind[] = ["audience", "member", "slorkstation"];

function EnabledKindsControls({
  enabledKinds,
  setEnabledKinds,
}: {
  enabledKinds: EnabledKinds;
  setEnabledKinds: (enabled: EnabledKinds) => void;
}) {
  const [mode, setMode] = useState<KindsMode>("live");
  const [draft, setDraft] = useState<EnabledKinds>(enabledKinds);

  // in live mode the draft tracks the server. in staging its a local edit
  useEffect(() => {
    if (mode !== "live") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((prev) => {
      if (KIND_ORDER.every((k) => prev[k] === enabledKinds[k])) return prev;
      return enabledKinds;
    });
  }, [enabledKinds, mode]);

  const handleModeChange = (next: KindsMode) => {
    if (next === "staging") {
      // seed the draft from current server state
      setDraft(enabledKinds);
    }
    setMode(next);
  };

  const toggle = (k: ToggleKind) => {
    const next = { ...draft, [k]: !draft[k] };
    setDraft(next);
    if (mode === "live") setEnabledKinds(next);
  };

  const hasPendingChanges =
    mode === "staging" &&
    KIND_ORDER.some((k) => draft[k] !== enabledKinds[k]);

  const fire = () => {
    if (!hasPendingChanges) return;
    setEnabledKinds(draft);
  };

  return (
    <section className={styles.section}>
      <h2>Active groups</h2>
      <div className={styles.sliderRow}>
        <span className={styles.sliderLabel}>Mode</span>
        <select
          value={mode}
          onChange={(e) => handleModeChange(e.target.value as KindsMode)}
        >
          <option value="live">Live (auto-send)</option>
          <option value="staging">Staging (fire manually)</option>
        </select>
      </div>
      <ul className={styles.kindList}>
        {KIND_ORDER.map((k) => {
          const liveOn = enabledKinds[k];
          const draftOn = draft[k];
          const diff = mode === "staging" && draftOn !== liveOn;
          return (
            <li key={k} className={styles.kindRow}>
              <label className={styles.kindLabel}>
                <input
                  type="checkbox"
                  checked={draftOn}
                  onChange={() => toggle(k)}
                />
                <span>{KIND_LABELS[k]}</span>
              </label>
              <span
                className={clsx(
                  styles.kindStatus,
                  diff && draftOn && styles.variantAdded,
                  diff && !draftOn && styles.variantRemoved,
                  !diff && liveOn && styles.variantLive,
                )}
              >
                {mode === "staging"
                  ? diff
                    ? draftOn
                      ? `staged: ON (live: OFF)`
                      : `staged: OFF (live: ON)`
                    : draftOn
                    ? "ON"
                    : "OFF"
                  : liveOn
                  ? "ON"
                  : "OFF"}
              </span>
            </li>
          );
        })}
      </ul>
      {mode === "staging" ? (
        <div className={styles.fireRow}>
          <button
            type="button"
            className={styles.fireButton}
            onClick={fire}
            disabled={!hasPendingChanges}
          >
            Fire
          </button>
          <span className={styles.fireHint}>
            {hasPendingChanges
              ? "Broadcast staged changes"
              : "No staged changes"}
          </span>
        </div>
      ) : null}
    </section>
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
                className={clsx(
                  styles.rosterItem,
                  isActive && styles.rosterItemActive,
                )}
              >
                #{d.index} [{d.kind}] - {d.clientId}
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
        gain={state.data.gain}
        updateMovement={updateMovement}
        setBeat={setBeat}
      />
    );
  }
  if (state.movement === "wake") {
    return (
      <WakeControls
        data={state.data}
        beat={beat}
        updateMovement={updateMovement}
        setBeat={setBeat}
      />
    );
  }
  if (state.movement === "turn") {
    return <TurnControls data={state.data} updateMovement={updateMovement} />;
  }
  if (state.movement === "ring") {
    return <RingControls data={state.data} updateMovement={updateMovement} />;
  }
  return null;
}

function RingControls({
  data,
  updateMovement,
}: {
  data: MovementData["ring"];
  updateMovement: Props["updateMovement"];
}) {
  return (
    <div className={styles.countingGrid}>
      <RingGainSlider gain={data.gain} updateMovement={updateMovement} />
      <RingNoiseSlider noise={data.noise} updateMovement={updateMovement} />
    </div>
  );
}

function RingGainSlider({
  gain,
  updateMovement,
}: {
  gain: number;
  updateMovement: Props["updateMovement"];
}) {
  const { value, onChange } = useCoalescedSlider<number>(gain, (v) =>
    updateMovement("ring", { gain: v }),
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Gain</span>
      <input
        type="range"
        min={RING_GAIN_MIN}
        max={RING_GAIN_MAX}
        step={0.01}
        value={value}
        onChange={(e) => {
          unlockAudio();
          onChange(Number(e.target.value));
        }}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>{value.toFixed(2)}×</span>
    </div>
  );
}

function RingNoiseSlider({
  noise,
  updateMovement,
}: {
  noise: number;
  updateMovement: Props["updateMovement"];
}) {
  const { value, onChange } = useCoalescedSlider<number>(noise, (v) =>
    updateMovement("ring", { noise: v }),
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Noise</span>
      <input
        type="range"
        min={RING_NOISE_MIN}
        max={RING_NOISE_MAX}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>{value.toFixed(2)}</span>
    </div>
  );
}

function TurnControls({
  data,
  updateMovement,
}: {
  data: MovementData["turn"];
  updateMovement: Props["updateMovement"];
}) {
  // live-only: any toggle ships immediately (turn voices are per-touch)
  const [toggledNotes, setToggledNotes] = useState<Set<string>>(
    () => new Set(data.activeNoteNames),
  );

  useEffect(() => {
    //mirror server pushes (e.g. another conductor edit) into the local set
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToggledNotes((prev) => {
      const now = new Set(data.activeNoteNames);
      if (now.size === prev.size && Array.from(now).every((n) => prev.has(n))) {
        return prev;
      }
      return now;
    });
  }, [data.activeNoteNames]);

  useEffect(() => {
    const serverSet = new Set(data.activeNoteNames);
    if (
      serverSet.size === toggledNotes.size &&
      Array.from(toggledNotes).every((n) => serverSet.has(n))
    ) {
      return;
    }
    updateMovement("turn", { activeNoteNames: Array.from(toggledNotes) });
  }, [toggledNotes, updateMovement, data.activeNoteNames]);

  const toggleNote = (note: string) => {
    setToggledNotes((prev) => {
      const next = new Set(prev);
      if (next.has(note)) next.delete(note);
      else next.add(note);
      return next;
    });
  };

  return (
    <div className={styles.countingGrid}>
      <TurnGainSlider gain={data.gain} updateMovement={updateMovement} />
      <TurnVibratoSlider
        vibratoMaxCents={data.vibratoMaxCents}
        updateMovement={updateMovement}
      />
      <TurnTimbreSlider
        timbreAmount={data.timbreAmount}
        updateMovement={updateMovement}
      />
      <TurnOctaveSelect octave={data.octave} updateMovement={updateMovement} />
      <TurnPalettePiano toggledNotes={toggledNotes} onToggle={toggleNote} />
    </div>
  );
}

function TurnPalettePiano({
  toggledNotes,
  onToggle,
}: {
  toggledNotes: Set<string>;
  onToggle: (note: string) => void;
}) {
  //same look as wake piano but always-live and single-variant
  return (
    <div className={styles.wakePiano}>
      <div className={styles.whites}>
        {WHITE_KEYS.map((k) => (
          <div
            key={k}
            aria-label={k}
            role="button"
            onClick={() => onToggle(k)}
            className={clsx(
              styles.key,
              toggledNotes.has(k) && styles.toggled,
              toggledNotes.has(k) && styles.variantLive,
            )}
          />
        ))}
      </div>
      <div className={styles.blacks}>
        {BLACK_KEYS.map((k, i) =>
          k ? (
            <div
              key={k}
              aria-label={k}
              role="button"
              onClick={() => onToggle(k)}
              className={clsx(
                styles.key,
                toggledNotes.has(k) && styles.toggled,
                toggledNotes.has(k) && styles.variantLive,
              )}
              style={{ "--idx": i } as React.CSSProperties}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

function TurnGainSlider({
  gain,
  updateMovement,
}: {
  gain: number;
  updateMovement: Props["updateMovement"];
}) {
  const { value, onChange } = useCoalescedSlider<number>(gain, (v) =>
    updateMovement("turn", { gain: v }),
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Gain</span>
      <input
        type="range"
        min={TURN_GAIN_MIN}
        max={TURN_GAIN_MAX}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>{value.toFixed(2)}×</span>
    </div>
  );
}

function TurnVibratoSlider({
  vibratoMaxCents,
  updateMovement,
}: {
  vibratoMaxCents: number;
  updateMovement: Props["updateMovement"];
}) {
  const { value, onChange } = useCoalescedSlider<number>(vibratoMaxCents, (v) =>
    updateMovement("turn", { vibratoMaxCents: v }),
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Vibrato</span>
      <input
        type="range"
        min={TURN_VIBRATO_CENTS_MIN}
        max={TURN_VIBRATO_CENTS_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>{value} ¢ max</span>
    </div>
  );
}

function TurnTimbreSlider({
  timbreAmount,
  updateMovement,
}: {
  timbreAmount: number;
  updateMovement: Props["updateMovement"];
}) {
  const { value, onChange } = useCoalescedSlider<number>(timbreAmount, (v) =>
    updateMovement("turn", { timbreAmount: v }),
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Timbre</span>
      <input
        type="range"
        min={TURN_TIMBRE_AMOUNT_MIN}
        max={TURN_TIMBRE_AMOUNT_MAX}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>{value.toFixed(2)}×</span>
    </div>
  );
}

function TurnOctaveSelect({
  octave,
  updateMovement,
}: {
  octave: number;
  updateMovement: Props["updateMovement"];
}) {
  const clampOct = (v: number) =>
    Math.max(
      TURN_OCTAVE_MIN,
      Math.min(TURN_OCTAVE_MAX, Math.floor(v) || TURN_OCTAVE_MIN),
    );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Octave</span>
      <input
        type="number"
        min={TURN_OCTAVE_MIN}
        max={TURN_OCTAVE_MAX}
        value={octave}
        onChange={(e) =>
          updateMovement("turn", { octave: clampOct(Number(e.target.value)) })
        }
        className={styles.customNInput}
      />
      <span className={styles.rangeHint}>
        ({TURN_OCTAVE_MIN}–{TURN_OCTAVE_MAX})
      </span>
    </div>
  );
}

type WakeMode = "live" | "staging";

function WakeControls({
  data,
  beat,
  updateMovement,
  setBeat,
}: {
  data: MovementData["wake"];
  beat: BeatState;
  updateMovement: Props["updateMovement"];
  setBeat: Props["setBeat"];
}) {
  const [mode, setMode] = useState<WakeMode>("live");
  const [toggledNotes, setToggledNotes] = useState<Set<string>>(
    () => new Set(data.activeNoteNames),
  );

  useEffect(() => {
    // staging keeps a local draft, live mirrors server
    if (mode !== "live") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToggledNotes((prev) => {
      const now = new Set(data.activeNoteNames);
      if (
        now.size === prev.size &&
        Array.from(now).every((note) => prev.has(note))
      ) {
        return prev;
      }
      return now;
    });
  }, [data.activeNoteNames, mode]);

  useEffect(() => {
    if (mode !== "live") return;
    updateMovement("wake", { activeNoteNames: Array.from(toggledNotes) });
  }, [toggledNotes, updateMovement, mode]);

  const handleModeChange = (next: WakeMode) => {
    if (next === "staging") {
      //start draft from whats currently on the server
      setToggledNotes(new Set(data.activeNoteNames));
    }
    //live: resync effect repopulates from server, dropping staged edits
    setMode(next);
  };

  const fire = () => {
    updateMovement("wake", { activeNoteNames: Array.from(toggledNotes) });
  };

  const baselineNotes = new Set(data.activeNoteNames);
  const hasPendingChanges =
    mode === "staging" &&
    (baselineNotes.size !== toggledNotes.size ||
      !Array.from(baselineNotes).every((n) => toggledNotes.has(n)));

  return (
    <div className={styles.countingGrid}>
      <WakeBpmSlider beat={beat} setBeat={setBeat} />
      <WakeGainSlider gain={data.gain} updateMovement={updateMovement} />
      <WakeModeSelect mode={mode} setMode={handleModeChange} />
      <WakePiano
        mode={mode}
        toggledNotes={toggledNotes}
        baselineNotes={baselineNotes}
        setToggledNotes={setToggledNotes}
        onFire={fire}
        hasPendingChanges={hasPendingChanges}
      />
    </div>
  );
}

function WakeModeSelect({
  mode,
  setMode,
}: {
  mode: WakeMode;
  setMode: (m: WakeMode) => void;
}) {
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Mode</span>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as WakeMode)}
      >
        <option value="live">Live (auto-send)</option>
        <option value="staging">Staging (fire manually)</option>
      </select>
    </div>
  );
}

const WHITE_KEYS = ["C", "D", "E", "F", "G", "A", "B"];
const BLACK_KEYS = ["C#", "D#", "", "F#", "G#", "A#"];

type KeyVariant = "off" | "live" | "active" | "added" | "removed";

function keyVariant(
  note: string,
  mode: WakeMode,
  toggled: Set<string>,
  baseline: Set<string>,
): KeyVariant {
  const inToggled = toggled.has(note);
  if (mode === "live") return inToggled ? "live" : "off";
  const inBaseline = baseline.has(note);
  if (inBaseline && inToggled) return "active";
  if (!inBaseline && inToggled) return "added";
  if (inBaseline && !inToggled) return "removed";
  return "off";
}

function WakePiano({
  mode,
  toggledNotes,
  baselineNotes,
  setToggledNotes,
  onFire,
  hasPendingChanges,
}: {
  mode: WakeMode;
  toggledNotes: Set<string>;
  baselineNotes: Set<string>;
  setToggledNotes: React.Dispatch<React.SetStateAction<Set<string>>>;
  onFire: () => void;
  hasPendingChanges: boolean;
}) {
  const toggleNote = (note: string) => {
    setToggledNotes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(note)) {
        newSet.delete(note);
      } else {
        newSet.add(note);
      }
      return newSet;
    });
  };

  return (
    <div>
      <div className={styles.wakePiano}>
        <div className={styles.whites}>
          {WHITE_KEYS.map((k) => (
            <WakePianoKey
              key={k}
              note={k}
              variant={keyVariant(k, mode, toggledNotes, baselineNotes)}
              onToggle={() => toggleNote(k)}
            />
          ))}
        </div>
        <div className={styles.blacks}>
          {BLACK_KEYS.map((k, i) =>
            k ? (
              <WakePianoKey
                key={k}
                note={k}
                variant={keyVariant(k, mode, toggledNotes, baselineNotes)}
                onToggle={() => toggleNote(k)}
                idx={i}
              />
            ) : // null for skipped key (there is no black key between e and f)
            null,
          )}
        </div>
      </div>
      {mode === "staging" ? (
        <div className={styles.fireRow}>
          <button
            type="button"
            className={styles.fireButton}
            onClick={onFire}
            disabled={!hasPendingChanges}
          >
            Fire
          </button>
          <span className={styles.fireHint}>
            {hasPendingChanges
              ? "Broadcast staged changes"
              : "No staged changes"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function WakePianoKey({
  note,
  variant,
  onToggle,
  idx,
}: {
  note: string;
  variant: KeyVariant;
  onToggle: () => void;
  idx?: number;
}) {
  const variantClass =
    variant === "live"
      ? styles.variantLive
      : variant === "active"
      ? styles.variantActive
      : variant === "added"
      ? styles.variantAdded
      : variant === "removed"
      ? styles.variantRemoved
      : undefined;
  return (
    <div
      aria-label={note}
      className={clsx(
        styles.key,
        variant !== "off" && styles.toggled,
        variantClass,
      )}
      role="button"
      onClick={onToggle}
      style={
        typeof idx === "number"
          ? ({ "--idx": idx } as React.CSSProperties)
          : undefined
      }
    />
  );
}

function WakeBpmSlider({
  beat,
  setBeat,
}: {
  beat: BeatState;
  setBeat: Props["setBeat"];
}) {
  const serverBpm = beat?.bpm ?? 60;
  const { value, onChange } = useCoalescedSlider<number>(serverBpm, (v) =>
    setBeat(v),
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Tempo</span>
      <input
        type="range"
        min={WAKE_BPM_MIN}
        max={WAKE_BPM_MAX}
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

function WakeGainSlider({
  gain,
  updateMovement,
}: {
  gain: number;
  updateMovement: Props["updateMovement"];
}) {
  const { value, onChange } = useCoalescedSlider<number>(gain, (v) =>
    updateMovement("wake", { gain: v }),
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Gain</span>
      <input
        type="range"
        min={WAKE_GAIN_MIN}
        max={WAKE_GAIN_MAX}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>{value.toFixed(2)}×</span>
    </div>
  );
}

// coalesce slider scrubs per rAF so we don't flood the socket
function ClickingControls({
  intensity,
  gain,
  updateMovement,
  setBeat,
}: {
  intensity: number;
  gain: number;
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
    <div className={styles.countingGrid}>
      <ClickingGainSlider gain={gain} updateMovement={updateMovement} />
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
    </div>
  );
}

function ClickingGainSlider({
  gain,
  updateMovement,
}: {
  gain: number;
  updateMovement: Props["updateMovement"];
}) {
  const { value, onChange } = useCoalescedSlider<number>(gain, (v) =>
    updateMovement("clicking", { gain: v }),
  );
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>Gain</span>
      <input
        type="range"
        min={CLICKING_GAIN_MIN}
        max={CLICKING_GAIN_MAX}
        step={0.01}
        value={value}
        onChange={(e) => {
          unlockAudio();
          onChange(Number(e.target.value));
        }}
        className={styles.sliderInput}
      />
      <span className={styles.sliderReadout}>{value.toFixed(2)}×</span>
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
  send: (v: T) => void,
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
    setBeat(v),
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
    updateMovement("counting", { gain: v }),
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
    updateMovement("counting", { pitchMultiply: semisToPitchMultiply(v) }),
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
