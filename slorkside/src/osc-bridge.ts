import WebSocket from "ws";
import type {
  BeatState,
  MovementData,
  MovementId,
  MovementState,
  ServerMessage,
} from "@shared/types.js";

import { osend } from "./lib/osc.js";

const WS_URL = process.env.WS_URL ?? "ws://localhost:3123/ws";
const RECONNECT_MS = 1000;
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 500);

// numbers for each note as used in bitmasking
const NOTE_TO_PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

function pitchClassMask(names: string[] | undefined): number {
  let mask = 0;
  for (const n of names ?? []) {
    const pc = NOTE_TO_PC[n];
    //a little add n shift action
    if (pc !== undefined) mask |= 1 << pc;
  }
  return mask;
}

function emitMovement(id: MovementId, data: MovementData[MovementId]) {
  if (id === "wake") {
    const d = data as MovementData["wake"];
    osend("/movement/wake", [
      { type: "f", value: d.gain },
      { type: "i", value: pitchClassMask(d.activeNoteNames) },
    ]);
  } else if (id === "turn") {
    const d = data as MovementData["turn"];
    osend("/movement/turn", [
      { type: "f", value: d.gain },
      { type: "s", value: (d.activeNoteNames ?? []).join(",") },
      { type: "i", value: d.octave },
      { type: "f", value: d.vibratoMaxCents },
      { type: "f", value: d.timbreAmount },
    ]);
  } else if (id === "clicking") {
    const d = data as MovementData["clicking"];
    osend("/movement/clicking", [{ type: "f", value: d.intensity }]);
  } else if (id === "counting") {
    const d = data as MovementData["counting"];
    osend("/movement/counting", [
      { type: "i", value: d.n },
      { type: "f", value: d.gain },
      { type: "f", value: d.pitchMultiply },
    ]);
  }
}

function emitState(state: MovementState) {
  if (!state) {
    osend("/state/none");
    return;
  }
  osend("/state/movement", [{ type: "s", value: state.movement }]);
  emitMovement(state.movement, state.data);
}

// anchorMs is a JS epoch ms (~1.7e12) — doesn't fit in OSC float32 without
// losing ms precision. Send it as a string and let the receiver parse.
function emitBeat(beat: BeatState) {
  if (!beat) {
    osend("/beat/clear");
    return;
  }
  osend("/beat", [
    { type: "s", value: String(beat.anchorMs) },
    { type: "f", value: beat.bpm },
    { type: "i", value: beat.originBeat ?? 0 },
  ]);
}

// Last-known snapshot for the heartbeat. The bridge re-broadcasts these on
// an interval so receivers that join late, drop packets, or restart can
// resync without us having to push delta-aware retry logic into them.
let lastState: MovementState = null;
let lastBeat: BeatState = null;

function handle(msg: ServerMessage) {
  if (msg.type === "state") {
    lastState = msg.state;
    emitState(msg.state);
  } else if (msg.type === "movement_update") {
    if (lastState && lastState.movement === msg.movement) {
      lastState = {
        movement: msg.movement,
        data: msg.data,
      } as MovementState;
    }
    emitMovement(msg.movement, msg.data);
  } else if (msg.type === "beat") {
    lastBeat = msg.beat;
    emitBeat(msg.beat);
  }
}

setInterval(() => {
  emitState(lastState);
  emitBeat(lastBeat);
}, HEARTBEAT_MS);

function connect() {
  console.log(`[ws] connecting to ${WS_URL}`);
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("[ws] open — hello as observer");
    ws.send(JSON.stringify({ type: "hello", role: "observer" }));
  });

  ws.on("message", (raw) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw.toString()) as ServerMessage;
    } catch {
      return;
    }
    handle(msg);
  });

  ws.on("close", () => {
    console.log(`[ws] closed — reconnecting in ${RECONNECT_MS}ms`);
    setTimeout(connect, RECONNECT_MS);
  });

  ws.on("error", (err) => {
    console.error("[ws] error:", err.message);
  });
}

connect();
