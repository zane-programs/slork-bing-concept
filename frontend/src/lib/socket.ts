import { useCallback, useEffect, useRef, useState } from "react";
import {
  BRIDGE_URL,
  CLIENT_ID_STORAGE_KEY,
  SOCKET_URL_BASE,
} from "../constants";
import type {
  BeatState,
  ClientId,
  ClientMessage,
  ClientRole,
  DeviceInfo,
  DeviceKind,
  EnabledKinds,
  MovementData,
  MovementId,
  MovementState,
  ServerMessage,
} from "@shared/types";
import { DEFAULT_ENABLED_KINDS } from "@shared/types";
import { getAccessToken, type AuthRole } from "./auth";

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

const WS_RECONNECT_MS = 1_000;

interface SyncSample {
  offset: number;
  rtt: number;
}

export interface SyncInfo {
  synced: boolean;
  rttMs: number | null;
  offsetMs: number;
}

export interface UseSocketOptions {
  // you a member?
  authRole?: AuthRole | null;
}

export function useSocket(
  role: ClientRole,
  enabled = true,
  options: UseSocketOptions = {},
) {
  const { authRole = null } = options;

  const socketRef = useRef<WebSocket | null>(null);
  // bridge is conductor-side only!!
  const bridgeRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isBridgeConnected, setIsBridgeConnected] = useState(false);
  const [state, setState] = useState<MovementState>(null);
  const [clientId, setClientId] = useState<ClientId | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [deviceKind, setDeviceKind] = useState<DeviceKind | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [beat, setBeat] = useState<BeatState>(null);
  const [enabledKinds, setEnabledKinds] = useState<EnabledKinds>(
    DEFAULT_ENABLED_KINDS,
  );


  const stateRef = useRef<MovementState>(null);
  const beatRef = useRef<BeatState>(null);
  const enabledKindsRef = useRef<EnabledKinds>(DEFAULT_ENABLED_KINDS);
  const hasSnapshotRef = useRef(false);

  const offsetRef = useRef(0);
  const samplesRef = useRef<SyncSample[]>([]);
  const [syncInfo, setSyncInfo] = useState<SyncInfo>({
    synced: false,
    rttMs: null,
    offsetMs: 0,
  });

  const send = useCallback((msg: ClientMessage) => {
    const payload = JSON.stringify(msg);
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
    const bridge = bridgeRef.current;
    if (bridge && bridge.readyState === WebSocket.OPEN) {
      bridge.send(payload);
    }
  }, []);

  const setMovement = useCallback(
    (movement: MovementId | null) => send({ type: "set_movement", movement }),
    [send],
  );

  const updateMovement = useCallback(
    <K extends MovementId>(movement: K, data: Partial<MovementData[K]>) =>
      send({ type: "update_movement", movement, data } as ClientMessage),
    [send],
  );

  const setBeatBpm = useCallback(
    (bpm: number | null) => send({ type: "set_beat", bpm }),
    [send],
  );

  const setEnabledKindsRemote = useCallback(
    (next: EnabledKinds) => send({ type: "set_enabled_kinds", enabled: next }),
    [send],
  );

  const getServerTime = useCallback(() => Date.now() + offsetRef.current, []);

  // rehydrate backend socket in case it goes down, starts late, etc
  const replenish = useCallback(
    (target: WebSocket) => {
      if (role !== "conductor") return;
      if (!hasSnapshotRef.current) return;
      if (target.readyState !== WebSocket.OPEN) return;
      const msg: ClientMessage = {
        type: "restore_state",
        state: stateRef.current,
        beat: beatRef.current,
        enabledKinds: enabledKindsRef.current,
      };
      target.send(JSON.stringify(msg));
    },
    [role],
  );

  useEffect(() => {
    if (!enabled) return;

    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let timeouts: ReturnType<typeof setTimeout>[] = [];
    let steadyInterval: ReturnType<typeof setInterval> | null = null;

    const clearLifecycleHandles = () => {
      for (const t of timeouts) clearTimeout(t);
      timeouts = [];
      if (steadyInterval) {
        clearInterval(steadyInterval);
        steadyInterval = null;
      }
    };

    const open = async () => {
      // resolve a fresh access token before each (re)connect. if authRole is
      // null we connect anonymously (audience). if it's set but no usable
      // session exists, we also fall back to anonymous — the app shell is
      // responsible for re-showing the passcode gate when that matters
      // (e.g. conductor).
      let url = SOCKET_URL_BASE + "/ws";
      if (authRole) {
        const token = await getAccessToken(authRole);
        if (closed) return;
        if (token) url += "?token=" + encodeURIComponent(token);
      }

      socket = new WebSocket(url);
      socketRef.current = socket;

      const sendPing = () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const ping: ClientMessage = { type: "time_ping", t0: Date.now() };
        socket.send(JSON.stringify(ping));
      };

      socket.onopen = () => {
        if (!socket) return;
        setIsConnected(true);
        const stored = readStoredClientId();
        const hello: ClientMessage = {
          type: "hello",
          ...(stored ? { clientId: stored } : {}),
          role,
        };
        socket.send(JSON.stringify(hello));

        replenish(socket);

        for (let i = 0; i < CLK_WARMUP_COUNT; i++) {
          timeouts.push(setTimeout(sendPing, i * CLK_WARMUP_INTERVAL_MS));
        }
        steadyInterval = setInterval(sendPing, CLK_STEADY_INTERVAL_MS);
      };

      socket.onclose = () => {
        setIsConnected(false);
        clearLifecycleHandles();
        if (closed) return;
        reconnectTimer = setTimeout(() => {
          void open();
        }, WS_RECONNECT_MS);
      };

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
          setDeviceKind(msg.deviceKind);
        } else if (msg.type === "state") {
          hasSnapshotRef.current = true;
          stateRef.current = msg.state;
          setState(msg.state);
        } else if (msg.type === "devices") {
          setDevices(msg.devices);
        } else if (msg.type === "beat") {
          hasSnapshotRef.current = true;
          beatRef.current = msg.beat;
          setBeat(msg.beat);
        } else if (msg.type === "enabled_kinds") {
          enabledKindsRef.current = msg.enabled;
          setEnabledKinds(msg.enabled);
        } else if (msg.type === "movement_update") {
          if (stateRef.current && stateRef.current.movement === msg.movement) {
            stateRef.current = {
              movement: msg.movement,
              data: msg.data,
            } as MovementState;
          }
          setState((prev) =>
            prev && prev.movement === msg.movement
              ? ({ movement: msg.movement, data: msg.data } as MovementState)
              : prev,
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
    };

    void open();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearLifecycleHandles();
      socket?.close();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [role, enabled, replenish, authRole]);

  useEffect(() => {
    if (!enabled || role !== "conductor" || !BRIDGE_URL) return;

    let closed = false;
    let bridge: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      bridge = new WebSocket(BRIDGE_URL);
      bridgeRef.current = bridge;

      bridge.onopen = () => {
        if (!bridge) return;
        setIsBridgeConnected(true);
        bridge.send(JSON.stringify({ type: "hello", role } as ClientMessage));
        replenish(bridge);
      };
      bridge.onclose = () => {
        setIsBridgeConnected(false);
        if (closed) return;
        reconnectTimer = setTimeout(open, WS_RECONNECT_MS);
      };
      bridge.onerror = (e) => {
        console.warn("[bridge] relay error");
        console.error(e);
      };
      bridge.onmessage = () => {};
    };

    open();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      bridge?.close();
      bridgeRef.current = null;
      setIsBridgeConnected(false);
    };
  }, [role, enabled, replenish]);

  return {
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
    setBeat: setBeatBpm,
    setEnabledKinds: setEnabledKindsRemote,
    getServerTime,
    syncInfo,
  };
}
