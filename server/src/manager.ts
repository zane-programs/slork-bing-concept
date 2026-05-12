import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import {
  MOVEMENT_DEFAULTS,
  isMovementId,
  type ClientId,
  type ClientMessage,
  type MovementId,
  type MovementState,
  type ServerMessage,
} from "@shared/movements.js";

export default class SocketManager {
  private wss: WebSocketServer;
  private state: MovementState = null;
  private clients = new Map<ClientId, WebSocket>();
  private idForSocket = new WeakMap<WebSocket, ClientId>();

  constructor(server: Server, path = "/ws") {
    this.wss = new WebSocketServer({ server, path });
    this.wss.on("connection", (socket) => this.handleConnection(socket));
    console.log("Manager initialized");
  }

  private handleConnection(socket: WebSocket) {
    console.log("Client connected (awaiting hello)");

    socket.on("message", (raw) => {
      const msg = this.parse(raw.toString());
      if (!msg) return;
      this.handleClientMessage(socket, msg);
    });

    socket.on("close", () => {
      const id = this.idForSocket.get(socket);
      if (id && this.clients.get(id) === socket) {
        this.clients.delete(id);
        console.log(`Client ${id} disconnected`);
      }
    });
  }

  private parse(text: string): ClientMessage | null {
    try {
      const parsed = JSON.parse(text) as ClientMessage;
      if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private handleClientMessage(socket: WebSocket, msg: ClientMessage) {
    if (msg.type === "hello") {
      this.handleHello(socket, msg.clientId);
      return;
    }
    // need socket to be associated wih a client id
    if (!this.idForSocket.has(socket)) return;

    if (msg.type === "set_movement") {
      this.setMovement(msg.movement);
    } else if (msg.type === "update_movement") {
      this.updateMovement(msg.movement, msg.data);
    }
  }

  private handleHello(socket: WebSocket, offered: ClientId | undefined) {
    const existing = this.idForSocket.get(socket);
    if (existing) {
      // handshake done already, just reacknowledge & resend state
      this.send(socket, { type: "assigned", clientId: existing });
      this.send(socket, { type: "state", state: this.state });
      return;
    }

    let id: ClientId;
    if (
      typeof offered === "string" &&
      offered.length > 0 &&
      !this.clients.has(offered)
    ) {
      id = offered;
    } else {
      id = randomUUID();
    }

    this.clients.set(id, socket);
    this.idForSocket.set(socket, id);
    console.log(`Client ${id} connected${offered === id ? " (reused)" : ""}`);

    this.send(socket, { type: "assigned", clientId: id });
    this.send(socket, { type: "state", state: this.state });
  }

  private setMovement(id: MovementId | null) {
    if (id === null) {
      this.state = null;
    } else if (isMovementId(id)) {
      this.state = {
        movement: id,
        data: { ...MOVEMENT_DEFAULTS[id] },
      } as MovementState;
    } else {
      return;
    }
    this.broadcast({ type: "state", state: this.state });
  }

  private updateMovement(id: MovementId, patch: Partial<Record<string, unknown>>) {
    if (!this.state || this.state.movement !== id) return;
    const next = { ...this.state.data, ...patch };
    this.state = { movement: this.state.movement, data: next } as MovementState;
    this.broadcast({
      type: "movement_update",
      movement: id,
      data: next,
    } as ServerMessage);
  }

  private send(socket: WebSocket, msg: ServerMessage) {
    socket.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage) {
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }
}
