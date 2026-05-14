import { useCallback, useEffect, useState } from "react";
import { useSocket } from "./lib/socket";
import { useWakeLock } from "./lib/wake-lock";
import { useHash } from "./lib/hash";
import { ConductorPanel } from "./lib/conductor";
import { MOVEMENT_COMPONENTS, type MovementState } from "./movements";
import { BeatProvider, BeatIndicator, useBeat } from "./lib/beat";
import { unlockAudio } from "./lib/audio";
import DeviceLanding from "./components/landing/landing";
import styles from "./App.module.css";

export default function App() {
  const hash = useHash();
  const role = hash === "#conductor" ? "conductor" : "device";
  const {
    isConnected,
    clientId,
    index,
    devices,
    state,
    beat,
    setMovement,
    updateMovement,
    setBeat,
    getServerTime,
  } = useSocket(role);
  const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock();
  const [joined, setJoined] = useState(false);

  const { tick, isActive, bus } = useBeat({
    beat,
    devices,
    getServerTime,
    myClientId: clientId,
  });

  useEffect(() => {
    return () => {
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  const join = useCallback(() => {
    unlockAudio();
    void acquireWakeLock();
    setJoined(true);
  }, [acquireWakeLock]);

  if (hash === "#conductor") {
    return (
      <ConductorPanel
        state={state}
        isConnected={isConnected}
        clientId={clientId}
        index={index}
        devices={devices}
        beat={beat}
        tick={tick}
        setMovement={setMovement}
        updateMovement={updateMovement}
        setBeat={setBeat}
      />
    );
  }

  if (!joined) {
    return <DeviceLanding onJoin={join} />;
  }

  return (
    <div>
      <BeatProvider bus={bus}>
        <div>
          {state ? renderMovement(state) : <p>Waiting for the conductor…</p>}
        </div>
      </BeatProvider>
      <div className={styles.indicatorWrap}>
        <BeatIndicator
          tick={tick}
          isActive={isActive}
          myIndex={index}
          bpm={beat?.bpm ?? null}
        />
      </div>
      <p className={styles.idLine}>
        id: {clientId ?? "…"}
        {index !== null ? ` · index #${index}` : ""}
      </p>
    </div>
  );
}

function renderMovement(state: NonNullable<MovementState>) {
  if (state.movement === "counting") {
    const M = MOVEMENT_COMPONENTS["counting"];
    return <M data={state.data} />;
  }
  if (state.movement === "clicking") {
    const M = MOVEMENT_COMPONENTS["clicking"];
    return <M data={state.data} />;
  }
  return null;
}
