import { useCallback, useEffect, useRef, useState } from "react";
import { CLIENT_ID_STORAGE_KEY, SOCKET_URL_BASE } from "../constants";
import type {
  BeatState,
  ClientId,
  ClientMessage,
  ClientRole,
  DeviceInfo,
  MovementData,
  MovementId,
  MovementState,
  ServerMessage,
} from "@shared/types";

function readStoredClientId(): ClientId | null {
  try {
    return localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredClientId(id: ClientId) {
  try {
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
  } catch {
    console.log("failed to store client id");
  }
}

// Cristian's algorithm: https://en.wikipedia.org/wiki/Cristian%27s_algorithm
const CLK_SAMPLE_WINDOW = 8;
const CLK_WARMUP_COUNT = 5;
const CLK_WARMUP_INTERVAL_MS = 200;
const CLK_STEADY_INTERVAL_MS = 5_000;

interface SyncSample {
  offset: number;
  rtt: number;
}

export interface SyncInfo {
  synced: boolean;
  rttMs: number | null;
  offsetMs: number;
}

export function useSocket(role: ClientRole, enabled = true) {
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [state, setState] = useState<MovementState>(null);
  const [clientId, setClientId] = useState<ClientId | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [beat, setBeat] = useState<BeatState>(null);

  const offsetRef = useRef(0);
  const samplesRef = useRef<SyncSample[]>([]);
  const [syncInfo, setSyncInfo] = useState<SyncInfo>({
    synced: false,
    rttMs: null,
    offsetMs: 0,
  });

  const send = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(msg));
  }, []);

  const setMovement = useCallback(
    (movement: MovementId | null) => send({ type: "set_movement", movement }),
    [send]
  );

  const updateMovement = useCallback(
    <K extends MovementId>(movement: K, data: Partial<MovementData[K]>) =>
      send({ type: "update_movement", movement, data } as ClientMessage),
    [send]
  );

  const setBeatBpm = useCallback(
    (bpm: number | null) => send({ type: "set_beat", bpm }),
    [send]
  );

  const getServerTime = useCallback(() => Date.now() + offsetRef.current, []);

  useEffect(() => {
    if (!enabled) return;
    const socket = new WebSocket(SOCKET_URL_BASE + "/ws");
    socketRef.current = socket;

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let steadyInterval: ReturnType<typeof setInterval> | null = null;

    const sendPing = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const ping: ClientMessage = { type: "time_ping", t0: Date.now() };
      socket.send(JSON.stringify(ping));
    };

    socket.onopen = () => {
      setIsConnected(true);
      const stored = readStoredClientId();
      const hello: ClientMessage = stored
        ? { type: "hello", clientId: stored, role }
        : { type: "hello", role };
      socket.send(JSON.stringify(hello));

      for (let i = 0; i < CLK_WARMUP_COUNT; i++) {
        timeouts.push(setTimeout(sendPing, i * CLK_WARMUP_INTERVAL_MS));
      }
      steadyInterval = setInterval(sendPing, CLK_STEADY_INTERVAL_MS);
    };
    socket.onclose = () => setIsConnected(false);

    socket.onmessage = (event) => {
      const t3 = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === "assigned") {
        writeStoredClientId(msg.clientId);
        setClientId(msg.clientId);
        setIndex(msg.index);
      } else if (msg.type === "state") {
        setState(msg.state);
      } else if (msg.type === "devices") {
        setDevices(msg.devices);
      } else if (msg.type === "beat") {
        setBeat(msg.beat);
      } else if (msg.type === "movement_update") {
        setState((prev) =>
          prev && prev.movement === msg.movement
            ? ({ movement: msg.movement, data: msg.data } as MovementState)
            : prev
        );
      } else if (msg.type === "time_pong") {
        const { t0, t1, t2 } = msg;
        const rtt = t3 - t0 - (t2 - t1);
        const offset = (t1 - t0 + (t2 - t3)) / 2;
        const samples = samplesRef.current;
        samples.push({ offset, rtt });
        if (samples.length > CLK_SAMPLE_WINDOW) samples.shift();
        let best = samples[0];
        for (const s of samples) if (s.rtt < best.rtt) best = s;
        offsetRef.current = best.offset;

        setSyncInfo({
          synced: true,
          rttMs: best.rtt,
          offsetMs: best.offset,
        });
      }
    };

    return () => {
      for (const t of timeouts) clearTimeout(t);
      if (steadyInterval) clearInterval(steadyInterval);
      socket.close();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [role, enabled]);

  return {
    isConnected,
    clientId,
    index,
    devices,
    state,
    beat,
    setMovement,
    updateMovement,
    setBeat: setBeatBpm,
    getServerTime,
    syncInfo,
  };
}
