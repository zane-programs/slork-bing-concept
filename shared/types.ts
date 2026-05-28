export type MovementId = "clicking" | "counting" | "wake" | "turn" | "ring";

export interface MovementData {
  clicking: { intensity: number; gain: number };
  counting: { n: number; gain: number; pitchMultiply: number };
  wake: {
    gain: number;
    /** note names without octave (octaves are generated on frontend) */
    activeNoteNames: string[];
  };
  turn: {
    gain: number;
    /** palette of pitch-classes the audience can play (e.g. ["D","E","G","A"]) */
    activeNoteNames: string[];
    /** single octave used for the whole field; pitch is picked by y-position */
    octave: number;
    /** max vibrato depth in cents at full tilt (beta) */
    vibratoMaxCents: number;
    /** how strongly gamma tilt opens/closes the timbre filter (0 = off) */
    timbreAmount: number;
  };
  ring: {
    /** master gain applied to both the dry ringtone bus and the noise bus */
    gain: number;
    /** 0 = ringtones only, 1 = noise only; equal-power crossfade between the two */
    noise: number;
  };
}

export type MovementState =
  | { [K in MovementId]: { movement: K; data: MovementData[K] } }[MovementId]
  | null;

export type ClientId = string;

export type ClientRole = "device" | "conductor" | "observer";

// audience vs (slork) member
export type DeviceKind = "audience" | "member";

// togglable kinds by the conductor
export type ToggleKind = "audience" | "member" | "slorkstation";
export type EnabledKinds = Record<ToggleKind, boolean>;

export const DEFAULT_ENABLED_KINDS: EnabledKinds = {
  audience: true,
  member: true,
  slorkstation: true,
};

export interface DeviceInfo {
  clientId: ClientId;
  index: number;
  kind: DeviceKind;
}

// beat N at: anchorMs + (N - originBeat) * (60_000 / bpm). originBeat steps on bpm changes.
export type BeatState = {
  anchorMs: number;
  bpm: number;
  originBeat?: number;
} | null;

export type ServerMessage =
  | {
      type: "assigned";
      clientId: ClientId;
      index: number | null;
      role: ClientRole;
      deviceKind: DeviceKind | null;
    }
  | { type: "state"; state: MovementState }
  | { type: "devices"; devices: DeviceInfo[] }
  | { type: "beat"; beat: BeatState }
  | { type: "enabled_kinds"; enabled: EnabledKinds }
  | { type: "time_pong"; t0: number; t1: number; t2: number }
  | {
      [K in MovementId]: {
        type: "movement_update";
        movement: K;
        data: MovementData[K];
      };
    }[MovementId];

export type ClientMessage =
  | {
      type: "hello";
      clientId?: ClientId;
      role?: ClientRole;
    }
  | { type: "set_movement"; movement: MovementId | null }
  | { type: "set_beat"; bpm: number | null }
  | { type: "set_enabled_kinds"; enabled: EnabledKinds }
  | { type: "time_ping"; t0: number }
  // (conductor-only)
  | {
      type: "restore_state";
      state: MovementState;
      beat: BeatState;
      enabledKinds: EnabledKinds;
    }
  | {
      [K in MovementId]: {
        type: "update_movement";
        movement: K;
        data: Partial<MovementData[K]>;
      };
    }[MovementId];
