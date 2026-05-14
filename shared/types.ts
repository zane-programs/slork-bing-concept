export type MovementId = "clicking" | "counting";

export interface MovementData {
  clicking: { intensity: number };
  counting: { n: number; gain: number; pitchMultiply: number };
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
export type BeatState =
  | { anchorMs: number; bpm: number; originBeat?: number }
  | null;

export type ServerMessage =
  | { type: "assigned"; clientId: ClientId; index: number | null; role: ClientRole }
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
