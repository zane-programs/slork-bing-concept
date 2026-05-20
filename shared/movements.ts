import type { MovementData, MovementId } from "./types.js";

export const MOVEMENT_IDS = [
  "wake",
  "turn",
  "clicking",
  "counting",
] as const satisfies readonly MovementId[];

export const MOVEMENT_NAMES: Record<MovementId, string> = {
  clicking: "Clicking",
  counting: "Counting",
  wake: "Wake",
  turn: "Turn",
};

export const MOVEMENT_DEFAULTS: { [K in MovementId]: MovementData[K] } = {
  clicking: { intensity: 0 },
  counting: { n: 4, gain: 1, pitchMultiply: 1 },
  //start with empty palettes; conductor curates
  wake: { gain: 0.4, activeNoteNames: [] },
  turn: {
    gain: 0.5,
    activeNoteNames: [],
    octave: 4,
    vibratoMaxCents: 35,
    timbreAmount: 0.7,
  },
};

export function isMovementId(value: unknown): value is MovementId {
  return (
    typeof value === "string" &&
    (MOVEMENT_IDS as readonly string[]).includes(value)
  );
}
