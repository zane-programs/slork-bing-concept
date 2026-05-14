import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import { MOVEMENT_DEFAULTS, isMovementId } from "@shared/movements.js";
import type {
  BeatState,
  ClientId,
  ClientMessage,
  ClientRole,
  DeviceInfo,
  MovementId,
  MovementState,
  ServerMessage,
} from "@shared/types.js";

const MIN_BPM = 1;
const MAX_BPM = 1000;

export default class SocketManager {
  private wss: WebSocketServer;
  private state: MovementState = null;
  private beat: BeatState = null;
  private clients = new Map<ClientId, WebSocket>();
  private indexForId = new Map<ClientId, number>();
  private roleForId = new Map<ClientId, ClientRole>();
  private idForSocket = new WeakMap<WebSocket, ClientId>();

  constructor(server: Server, path = "/ws") {
    this.wss = new WebSocketServer({ server, path });
    this.wss.on("connection", (socket) => this.handleConnection(socket));
    console.log("Manager initialized");
  }

  private handleConnection(socket: WebSocket) {
    console.log("Client connected (awaiting hello)");

    socket.on("message", (raw) => {
      const t1 = Date.now();
      const msg = this.parse(raw.toString());
      if (!msg) return;
      this.handleClientMessage(socket, msg, t1);
    });

    socket.on("close", () => {
      const id = this.idForSocket.get(socket);
      if (id && this.clients.get(id) === socket) {
        const wasDevice = this.roleForId.get(id) === "device";
        this.clients.delete(id);
        this.indexForId.delete(id);
        this.roleForId.delete(id);
        console.log(`Client ${id} disconnected`);
        if (wasDevice) this.broadcastDevices();
      }
    });
  }

  private parse(text: string): ClientMessage | null {
    try {
      const parsed = JSON.parse(text) as ClientMessage;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.type !== "string"
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private handleClientMessage(
    socket: WebSocket,
    msg: ClientMessage,
    t1: number
  ) {
    if (msg.type === "hello") {
      this.handleHello(socket, msg.clientId, msg.role);
      return;
    }
    if (msg.type === "time_ping") {
      this.send(socket, {
        type: "time_pong",
        t0: msg.t0,
        t1,
        t2: Date.now(),
      });
      return;
    }
    const id = this.idForSocket.get(socket);
    if (!id) return;
    if (this.roleForId.get(id) !== "conductor") return;

    if (msg.type === "set_movement") {
      this.setMovement(msg.movement);
    } else if (msg.type === "update_movement") {
      this.updateMovement(msg.movement, msg.data);
    } else if (msg.type === "set_beat") {
      this.setBeat(msg.bpm);
    }
  }

  private handleHello(
    socket: WebSocket,
    offered: ClientId | undefined,
    offeredRole: ClientRole | undefined
  ) {
    const role: ClientRole =
      offeredRole === "conductor" ? "conductor" : "device";

    const existing = this.idForSocket.get(socket);
    if (existing) {
      // role is locked for the session; reconnect to switch.
      const existingRole = this.roleForId.get(existing) ?? "device";
      const idx = this.indexForId.get(existing) ?? null;
      this.send(socket, {
        type: "assigned",
        clientId: existing,
        index: idx,
        role: existingRole,
      });
      this.send(socket, { type: "devices", devices: this.devices() });
      this.send(socket, { type: "state", state: this.state });
      this.send(socket, { type: "beat", beat: this.beat });
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

    const index = role === "device" ? this.assignIndex() : null;

    this.clients.set(id, socket);
    this.roleForId.set(id, role);
    if (index !== null) this.indexForId.set(id, index);
    this.idForSocket.set(socket, id);
    console.log(
      `Client ${id} connected as ${role}${
        index !== null ? ` (index ${index})` : ""
      }${offered === id ? " - reused id" : ""}`
    );

    this.send(socket, { type: "assigned", clientId: id, index, role });
    this.send(socket, { type: "state", state: this.state });
    this.send(socket, { type: "beat", beat: this.beat });
    if (role === "device") {
      this.broadcastDevices();
    } else {
      this.send(socket, { type: "devices", devices: this.devices() });
    }
  }

  private assignIndex(): number {
    const used = new Set(this.indexForId.values());
    let i = 0;
    while (used.has(i)) i++;
    return i;
  }

  private devices(): DeviceInfo[] {
    const list: DeviceInfo[] = [];
    for (const [clientId, index] of this.indexForId) {
      list.push({ clientId, index });
    }
    list.sort((a, b) => a.index - b.index);
    return list;
  }

  private broadcastDevices() {
    this.broadcast({ type: "devices", devices: this.devices() });
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

  private updateMovement(
    id: MovementId,
    patch: Partial<Record<string, unknown>>
  ) {
    if (!this.state || this.state.movement !== id) return;
    const prev = this.state.data as Record<string, unknown>;
    let changed = false;
    for (const k of Object.keys(patch)) {
      if (prev[k] !== patch[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    const next = { ...this.state.data, ...patch };
    this.state = { movement: this.state.movement, data: next } as MovementState;
    this.broadcast({
      type: "movement_update",
      movement: id,
      data: next,
    } as ServerMessage);
  }

  // bpm changes re-anchor to the next beat boundary in the old schedule.
  // max(0, ...) on stepsAhead so rapid scrubs don't keep deferring the next beat.
  private setBeat(bpm: number | null) {
    if (bpm === null) {
      if (this.beat === null) return;
      this.beat = null;
    } else {
      const n = Number(bpm);
      if (!Number.isFinite(n)) return;
      const clamped = Math.max(MIN_BPM, Math.min(MAX_BPM, n));
      if (this.beat) {
        if (this.beat.bpm === clamped) return;
        const now = Date.now();
        const oldPeriodMs = 60_000 / this.beat.bpm;
        const oldOrigin = this.beat.originBeat ?? 0;
        const beatsSinceAnchor = (now - this.beat.anchorMs) / oldPeriodMs;
        const stepsAhead = Math.max(0, Math.ceil(beatsSinceAnchor));
        const newOrigin = oldOrigin + stepsAhead;
        const newAnchor = this.beat.anchorMs + stepsAhead * oldPeriodMs;
        this.beat = {
          anchorMs: newAnchor,
          bpm: clamped,
          originBeat: newOrigin,
        };
      } else {
        this.beat = { anchorMs: Date.now(), bpm: clamped, originBeat: 0 };
      }
    }
    this.broadcast({ type: "beat", beat: this.beat });
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
