import { useCallback, useEffect, useState } from "react";
import { useSocket } from "./lib/socket";
import { useWakeLock } from "./lib/wake-lock";
import { useHash } from "./lib/hash";
import { ConductorPanel } from "./lib/conductor";
import { MOVEMENT_COMPONENTS, type MovementState } from "./movements";
import { BeatProvider, BeatIndicator, useBeat } from "./lib/beat";
import { unlockAudio } from "./lib/audio";
import { requestOrientationPermission } from "./lib/orientation";
import DeviceLanding from "./components/landing/landing";
import TestingPage from "./components/testing/testing";
import styles from "./App.module.css";

export default function App() {
  const hash = useHash();

  if (hash === "#testing") {
    return <TestingPage />;
  }

  return <AppInner hash={hash} />;
}

function AppInner({ hash }: { hash: string }) {
  const role = hash === "#conductor" ? "conductor" : "device";
  const [joined, setJoined] = useState(false);
  const socketEnabled = role === "conductor" || joined;
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
  } = useSocket(role, socketEnabled);
  const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock();

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
    // ios requires sync invocation in the same user gesture
    unlockAudio();
    void acquireWakeLock();
    void requestOrientationPermission();
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

  if (!state) {
    return <div className={styles.blackdrop} />;
  }

  return (
    <div>
      <BeatProvider bus={bus}>
        <div>{renderMovement(state)}</div>
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
  if (state.movement === "wake") {
    const M = MOVEMENT_COMPONENTS["wake"];
    return <M data={state.data} />;
  }
  if (state.movement === "turn") {
    const M = MOVEMENT_COMPONENTS["turn"];
    return <M data={state.data} />;
  }
  return null;
}
