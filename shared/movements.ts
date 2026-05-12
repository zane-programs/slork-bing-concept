/**
 * this is a shared typing/config file for movements, used by both the frontend and backend (typescript
 * means it's convenient to do this!) data types/structures are defined separately for each movement :3
 */

export const MOVEMENT_IDS = ["movement-1", "movement-2"] as const;
export type MovementId = (typeof MOVEMENT_IDS)[number];

export const MOVEMENT_NAMES: Record<MovementId, string> = {
  "movement-1": "Movement 1",
  "movement-2": "Movement 2",
};

export interface MovementData {
  "movement-1": { phase: number };
  "movement-2": { note: string };
}

export const MOVEMENT_DEFAULTS: { [K in MovementId]: MovementData[K] } = {
  "movement-1": { phase: 0 },
  "movement-2": { note: "" },
};

export type MovementState =
  | { [K in MovementId]: { movement: K; data: MovementData[K] } }[MovementId]
  | null;

export function isMovementId(value: unknown): value is MovementId {
  return (
    typeof value === "string" && (MOVEMENT_IDS as readonly string[]).includes(value)
  );
}

export type ClientId = string;

export type ServerMessage =
  | { type: "assigned"; clientId: ClientId }
  | { type: "state"; state: MovementState }
  | {
      [K in MovementId]: {
        type: "movement_update";
        movement: K;
        data: MovementData[K];
      };
    }[MovementId];

export type ClientMessage =
  | { type: "hello"; clientId?: ClientId }
  | { type: "set_movement"; movement: MovementId | null }
  | {
      [K in MovementId]: {
        type: "update_movement";
        movement: K;
        data: Partial<MovementData[K]>;
      };
    }[MovementId];
