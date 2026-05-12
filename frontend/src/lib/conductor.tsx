import {
  MOVEMENT_IDS,
  MOVEMENT_NAMES,
  type ClientId,
  type MovementData,
  type MovementId,
  type MovementState,
} from "./movements";

interface Props {
  state: MovementState;
  isConnected: boolean;
  clientId: ClientId | null;
  setMovement: (movement: MovementId | null) => void;
  updateMovement: <K extends MovementId>(
    movement: K,
    data: Partial<MovementData[K]>,
  ) => void;
}

export function ConductorPanel({
  state,
  isConnected,
  clientId,
  setMovement,
  updateMovement,
}: Props) {
  return (
    <div>
      <h1>Conductor</h1>
      <p>Socket: {isConnected ? "connected" : "disconnected"}</p>
      <p>Your id: {clientId ?? "…"}</p>
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
      {state ? <MovementControls state={state} updateMovement={updateMovement} /> : null}
    </div>
  );
}

function MovementControls({
  state,
  updateMovement,
}: {
  state: NonNullable<MovementState>;
  updateMovement: Props["updateMovement"];
}) {
  if (state.movement === "movement-1") {
    return (
      <div>
        <label>
          Phase:{" "}
          <input
            type="range"
            min={0}
            max={100}
            value={state.data.phase}
            onChange={(e) =>
              updateMovement("movement-1", { phase: Number(e.target.value) })
            }
          />
          <span> {state.data.phase}</span>
        </label>
      </div>
    );
  }
  if (state.movement === "movement-2") {
    return (
      <div>
        <label>
          Note:{" "}
          <input
            type="text"
            value={state.data.note}
            onChange={(e) =>
              updateMovement("movement-2", { note: e.target.value })
            }
          />
        </label>
      </div>
    );
  }
  return null;
}
