import { useEffect } from "react";
import { useSocket } from "./lib/socket";
import { useWakeLock } from "./lib/wake-lock";
import { useHash } from "./lib/hash";
import { ConductorPanel } from "./lib/conductor";
import { MOVEMENT_RENDERERS } from "./lib/movements";

export default function App() {
  const { isConnected, clientId, state, setMovement, updateMovement } = useSocket();
  const hash = useHash();
  const {
    acquire: acquireWakeLock,
    release: releaseWakeLock,
    isLocked: isWakeLocked,
  } = useWakeLock();

  useEffect(() => {
    return () => {
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  if (hash === "#conductor") {
    return (
      <ConductorPanel
        state={state}
        isConnected={isConnected}
        clientId={clientId}
        setMovement={setMovement}
        updateMovement={updateMovement}
      />
    );
  }

  return (
    <div>
      <p>
        Hello {isWakeLocked ? " (wake lock active)" : " (wake lock inactive)"}
      </p>
      <button onClick={isWakeLocked ? releaseWakeLock : acquireWakeLock}>
        {isWakeLocked ? "Release" : "Acquire"} Wake Lock
      </button>
      <div>
        {state
          ? renderMovement(state)
          : <p>Waiting for the conductor…</p>}
      </div>
      <p style={{ opacity: 0.5, fontSize: "0.8em" }}>
        id: {clientId ?? "…"}
      </p>
    </div>
  );
}

function renderMovement(state: NonNullable<ReturnType<typeof useSocket>["state"]>) {
  if (state.movement === "movement-1") {
    return MOVEMENT_RENDERERS["movement-1"](state.data);
  }
  if (state.movement === "movement-2") {
    return MOVEMENT_RENDERERS["movement-2"](state.data);
  }
  return null;
}
