import type { MovementData, MovementId } from "./types.js";

export const MOVEMENT_IDS = [
  "clicking",
  "counting",
] as const satisfies readonly MovementId[];

export const MOVEMENT_NAMES: Record<MovementId, string> = {
  clicking: "Clicking",
  counting: "Counting",
};

export const MOVEMENT_DEFAULTS: { [K in MovementId]: MovementData[K] } = {
  clicking: { intensity: 0 },
  counting: { n: 4, gain: 1, pitchMultiply: 1 },
};

export function isMovementId(value: unknown): value is MovementId {
  return (
    typeof value === "string" && (MOVEMENT_IDS as readonly string[]).includes(value)
  );
}
