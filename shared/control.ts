import { MOVEMENT_DEFAULTS, isMovementId } from "./movements.js";
import type {
  BeatState,
  EnabledKinds,
  MovementData,
  MovementId,
  MovementState,
  ToggleKind,
} from "./types.js";
import { DEFAULT_ENABLED_KINDS } from "./types.js";

export const MIN_BPM = 1;
export const MAX_BPM = 1000;

type StateListener = (state: MovementState) => void;
type BeatListener = (beat: BeatState) => void;
type MovementUpdateListener = (
  movement: MovementId,
  data: MovementData[MovementId],
) => void;
type EnabledKindsListener = (enabled: EnabledKinds) => void;

const TOGGLE_KINDS: readonly ToggleKind[] = [
  "audience",
  "member",
  "slorkstation",
];

function sanitizeEnabledKinds(input: unknown): EnabledKinds {
  const out = { ...DEFAULT_ENABLED_KINDS };
  if (!input || typeof input !== "object") return out;
  const rec = input as Record<string, unknown>;
  for (const k of TOGGLE_KINDS) {
    if (typeof rec[k] === "boolean") out[k] = rec[k] as boolean;
  }
  return out;
}

function enabledKindsEqual(a: EnabledKinds, b: EnabledKinds): boolean {
  return TOGGLE_KINDS.every((k) => a[k] === b[k]);
}

// shared state machine logic used by osc-bridge server and main ws
// (i extracted this to decouple the osc side from potentially cloud ws)
export class ControlState {
  private _state: MovementState = null;
  private _beat: BeatState = null;
  private _enabledKinds: EnabledKinds = { ...DEFAULT_ENABLED_KINDS };
  private stateListeners = new Set<StateListener>();
  private beatListeners = new Set<BeatListener>();
  private movementUpdateListeners = new Set<MovementUpdateListener>();
  private enabledKindsListeners = new Set<EnabledKindsListener>();

  get state(): MovementState {
    return this._state;
  }
  get beat(): BeatState {
    return this._beat;
  }
  get enabledKinds(): EnabledKinds {
    return this._enabledKinds;
  }

  onStateChange(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  }
  onBeatChange(fn: BeatListener): () => void {
    this.beatListeners.add(fn);
    return () => {
      this.beatListeners.delete(fn);
    };
  }
  onMovementUpdate(fn: MovementUpdateListener): () => void {
    this.movementUpdateListeners.add(fn);
    return () => {
      this.movementUpdateListeners.delete(fn);
    };
  }
  onEnabledKindsChange(fn: EnabledKindsListener): () => void {
    this.enabledKindsListeners.add(fn);
    return () => {
      this.enabledKindsListeners.delete(fn);
    };
  }

  setMovement(id: MovementId | null): boolean {
    if (id === null) {
      this._state = null;
    } else if (isMovementId(id)) {
      this._state = {
        movement: id,
        data: { ...MOVEMENT_DEFAULTS[id] },
      } as MovementState;
    } else {
      return false;
    }
    for (const fn of this.stateListeners) fn(this._state);
    return true;
  }

  updateMovement(
    id: MovementId,
    patch: Partial<Record<string, unknown>>,
  ): boolean {
    if (!this._state || this._state.movement !== id) return false;
    const prev = this._state.data as Record<string, unknown>;
    let changed = false;
    for (const k of Object.keys(patch)) {
      if (prev[k] !== patch[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    const next = { ...this._state.data, ...patch };
    this._state = {
      movement: this._state.movement,
      data: next,
    } as MovementState;
    for (const fn of this.movementUpdateListeners) {
      fn(id, next as MovementData[MovementId]);
    }
    return true;
  }

  setEnabledKinds(next: EnabledKinds): boolean {
    const sanitized = sanitizeEnabledKinds(next);
    if (enabledKindsEqual(this._enabledKinds, sanitized)) return false;
    this._enabledKinds = sanitized;
    for (const fn of this.enabledKindsListeners) fn(this._enabledKinds);
    return true;
  }

  restore(
    state: MovementState,
    beat: BeatState,
    enabledKinds?: EnabledKinds,
  ): void {
    this._state = state;
    this._beat = beat;
    for (const fn of this.stateListeners) fn(this._state);
    for (const fn of this.beatListeners) fn(this._beat);
    if (enabledKinds) {
      const sanitized = sanitizeEnabledKinds(enabledKinds);
      if (!enabledKindsEqual(this._enabledKinds, sanitized)) {
        this._enabledKinds = sanitized;
        for (const fn of this.enabledKindsListeners) fn(this._enabledKinds);
      }
    }
  }

  setBeat(bpm: number | null): boolean {
    if (bpm === null) {
      if (this._beat === null) return false;
      this._beat = null;
    } else {
      const n = Number(bpm);
      if (!Number.isFinite(n)) return false;
      const clamped = Math.max(MIN_BPM, Math.min(MAX_BPM, n));
      if (this._beat) {
        if (this._beat.bpm === clamped) return false;
        const now = Date.now();
        const oldPeriodMs = 60_000 / this._beat.bpm;
        const oldOrigin = this._beat.originBeat ?? 0;
        const beatsSinceAnchor = (now - this._beat.anchorMs) / oldPeriodMs;
        const stepsAhead = Math.max(0, Math.ceil(beatsSinceAnchor));
        const newOrigin = oldOrigin + stepsAhead;
        const newAnchor = this._beat.anchorMs + stepsAhead * oldPeriodMs;
        this._beat = {
          anchorMs: newAnchor,
          bpm: clamped,
          originBeat: newOrigin,
        };
      } else {
        this._beat = { anchorMs: Date.now(), bpm: clamped, originBeat: 0 };
      }
    }
    for (const fn of this.beatListeners) fn(this._beat);
    return true;
  }
}
