import { useCallback, useEffect, useRef, useState } from "react";
import { CLIENT_ID_STORAGE_KEY, SOCKET_URL_BASE } from "../constants";
import type {
  ClientId,
  ClientMessage,
  MovementData,
  MovementId,
  MovementState,
  ServerMessage,
} from "@shared/movements";

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

export function useSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [state, setState] = useState<MovementState>(null);
  const [clientId, setClientId] = useState<ClientId | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(msg));
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

  useEffect(() => {
    const socket = new WebSocket(SOCKET_URL_BASE + "/ws");
    socketRef.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      const stored = readStoredClientId();
      const hello: ClientMessage = stored
        ? { type: "hello", clientId: stored }
        : { type: "hello" };
      socket.send(JSON.stringify(hello));
    };
    socket.onclose = () => setIsConnected(false);

    socket.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === "assigned") {
        writeStoredClientId(msg.clientId);
        setClientId(msg.clientId);
      } else if (msg.type === "state") {
        setState(msg.state);
      } else if (msg.type === "movement_update") {
        setState((prev) =>
          prev && prev.movement === msg.movement
            ? ({ movement: msg.movement, data: msg.data } as MovementState)
            : prev,
        );
      }
    };

    return () => socket.close();
  }, []);

  return { isConnected, clientId, state, setMovement, updateMovement };
}
