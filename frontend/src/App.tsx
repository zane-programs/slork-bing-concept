import { useCallback, useEffect, useState } from "react";
import { useSocket } from "./lib/socket";
import { useWakeLock } from "./lib/wake-lock";
import { useHash } from "./lib/hash";
import { hasUsableSession, type AuthRole } from "./lib/auth";
import { ConductorPanel } from "./lib/conductor";
import { MOVEMENT_COMPONENTS, type MovementState } from "./movements";
import Ring from "./movements/ring";
import type { DeviceKind } from "@shared/types";
import { BeatProvider, BeatIndicator, useBeat } from "./lib/beat";
import { unlockAudio } from "./lib/audio";
import { requestOrientationPermission } from "./lib/orientation";
import DeviceLanding from "./components/landing/landing";
import TestingPage from "./components/testing/testing";
import PasscodeGate from "./components/passcode-gate/passcode-gate";
import styles from "./App.module.css";

export default function App() {
const hash = useHash();

  if (hash === "#testing") {
    return <TestingPage />;
  }

  return <AppInner hash={hash} />;
}

function AppInner({ hash }: { hash: string }) {
  const isConductor = hash === "#conductor";
  const isMemberJoin = hash === "#join-member";
  const role = isConductor ? "conductor" : "device";

  const [conductorAuthed, setConductorAuthed] = useState<boolean>(() =>
    isConductor ? hasUsableSession("conductor") : false,
  );
  const [memberAuthed, setMemberAuthed] = useState<boolean>(() =>
    isMemberJoin ? hasUsableSession("member") : false,
  );
  const [joined, setJoined] = useState(false);

  // socket connects when one of:
  // conductor that passed the passcode (or had a valid stored session)
  // regular audience that hit "Join"
  // member that passed the passcode AND hit "Join"
  const socketEnabled = isConductor
    ? conductorAuthed
    : joined && (!isMemberJoin || memberAuthed);

  const authRole: AuthRole | null = isConductor
    ? conductorAuthed
      ? "conductor"
      : null
    : isMemberJoin && memberAuthed
    ? "member"
    : null;

  const {
    isConnected,
    isBridgeConnected,
    clientId,
    index,
    deviceKind,
    devices,
    state,
    beat,
    enabledKinds,
    setMovement,
    updateMovement,
    setBeat,
    setEnabledKinds,
    getServerTime,
  } = useSocket(role, socketEnabled, { authRole });
  const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock();

  const { tick, isActive, bus } = useBeat({
    beat,
    devices,
    enabledKinds,
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

  if (isConductor) {
    if (!conductorAuthed) {
      return (
        <PasscodeGate
          title="Conductor login"
          role="conductor"
          onAuthorized={() => setConductorAuthed(true)}
        />
      );
    }
    return (
      <ConductorPanel
        state={state}
        isConnected={isConnected}
        isBridgeConnected={isBridgeConnected}
        clientId={clientId}
        index={index}
        devices={devices}
        beat={beat}
        tick={tick}
        enabledKinds={enabledKinds}
        setMovement={setMovement}
        updateMovement={updateMovement}
        setBeat={setBeat}
        setEnabledKinds={setEnabledKinds}
      />
    );
  }

  if (isMemberJoin && !memberAuthed) {
    return (
      <PasscodeGate
        title="SLOrk member"
        role="member"
        onAuthorized={() => setMemberAuthed(true)}
      />
    );
  }

  if (!joined) {
    return <DeviceLanding onJoin={join} />;
  }

  const myKind = deviceKind ?? "audience";
  const myKindEnabled = enabledKinds[myKind];

  if (!state || !myKindEnabled) {
    // if disabled show blackdrop!
    return <div className={styles.blackdrop} />;
  }

  return (
    <div>
      <BeatProvider bus={bus}>
        <div>{renderMovement(state, deviceKind)}</div>
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
        {deviceKind ? ` · ${deviceKind}` : ""}
      </p>
    </div>
  );
}

function renderMovement(
  state: NonNullable<MovementState>,
  deviceKind: DeviceKind | null,
) {
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
  if (state.movement === "ring") {
    return <Ring data={state.data} deviceKind={deviceKind} />;
  }
  return null;
}
