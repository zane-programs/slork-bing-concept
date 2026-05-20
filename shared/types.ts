export type MovementId = "clicking" | "counting" | "wake" | "turn";

export interface MovementData {
  clicking: { intensity: number };
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
}

export type MovementState =
  | { [K in MovementId]: { movement: K; data: MovementData[K] } }[MovementId]
  | null;

export type ClientId = string;

export type ClientRole = "device" | "conductor";

export interface DeviceInfo {
  clientId: ClientId;
  index: number;
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
    }
  | { type: "state"; state: MovementState }
  | { type: "devices"; devices: DeviceInfo[] }
  | { type: "beat"; beat: BeatState }
  | { type: "time_pong"; t0: number; t1: number; t2: number }
  | {
      [K in MovementId]: {
        type: "movement_update";
        movement: K;
        data: MovementData[K];
      };
    }[MovementId];

export type ClientMessage =
  | { type: "hello"; clientId?: ClientId; role?: ClientRole }
  | { type: "set_movement"; movement: MovementId | null }
  | { type: "set_beat"; bpm: number | null }
  | { type: "time_ping"; t0: number }
  | {
      [K in MovementId]: {
        type: "update_movement";
        movement: K;
        data: Partial<MovementData[K]>;
      };
    }[MovementId];
