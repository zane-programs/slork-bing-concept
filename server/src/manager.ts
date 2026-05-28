import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ControlState } from "@shared/control.js";
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
} from "@shared/types.js";
import { verifyAccess, type VerifiedClaim } from "./tokens.js";

export default class SocketManager {
  private wss: WebSocketServer;
  private control = new ControlState();
  private clients = new Map<ClientId, WebSocket>();
  private indexForId = new Map<ClientId, number>();
  private roleForId = new Map<ClientId, ClientRole>();
  private kindForId = new Map<ClientId, DeviceKind>();
  private idForSocket = new WeakMap<WebSocket, ClientId>();
  private claimForSocket = new WeakMap<WebSocket, VerifiedClaim>();

  constructor(server: Server, path = "/ws") {
    this.wss = new WebSocketServer({ server, path });
    this.wss.on("connection", (socket, req) =>
      this.handleConnection(socket, req),
    );

    this.control.onStateChange((state) => this.broadcastState(state));
    this.control.onMovementUpdate((id, data) =>
      this.broadcastMovementUpdate(id, data),
    );
    this.control.onBeatChange((beat) => this.broadcastBeat(beat));
    this.control.onEnabledKindsChange((enabled) =>
      this.handleEnabledKindsChange(enabled),
    );

    console.log("Manager initialized");
  }

  private handleConnection(socket: WebSocket, req: IncomingMessage) {
    const claim = parseAndVerifyTokenFromUrl(req.url);
    if (claim) this.claimForSocket.set(socket, claim);
    console.log(
      `Client connected (awaiting hello${claim ? `, token: ${claim.role}` : ""})`,
    );

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
        this.kindForId.delete(id);
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
      this.control.setMovement(msg.movement);
    } else if (msg.type === "update_movement") {
      this.control.updateMovement(msg.movement as MovementId, msg.data);
    } else if (msg.type === "set_beat") {
      this.control.setBeat(msg.bpm);
    } else if (msg.type === "set_enabled_kinds") {
      this.control.setEnabledKinds(msg.enabled);
    } else if (msg.type === "restore_state") {
      this.control.restore(msg.state, msg.beat, msg.enabledKinds);
    }
  }

  private handleHello(
    socket: WebSocket,
    offered: ClientId | undefined,
    offeredRole: ClientRole | undefined,
  ) {
    const claim = this.claimForSocket.get(socket) ?? null;
    const { role, kind } = deriveRoleAndKind(claim, offeredRole);

    const existing = this.idForSocket.get(socket);
    if (existing) {
      // role is locked for the session; reconnect to switch.
      const existingRole = this.roleForId.get(existing) ?? "device";
      const idx = this.indexForId.get(existing) ?? null;
      const existingKind = this.kindForId.get(existing) ?? null;
      this.send(socket, {
        type: "assigned",
        clientId: existing,
        index: idx,
        role: existingRole,
        deviceKind: existingKind,
      });
      this.send(socket, { type: "devices", devices: this.devices() });
      const enabledForExisting = this.isIdEnabled(existing);
      this.send(socket, {
        type: "state",
        state: enabledForExisting ? this.control.state : null,
      });
      this.send(socket, {
        type: "beat",
        beat: enabledForExisting ? this.control.beat : null,
      });
      this.send(socket, {
        type: "enabled_kinds",
        enabled: this.control.enabledKinds,
      });
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
    if (kind !== null) this.kindForId.set(id, kind);
    this.idForSocket.set(socket, id);
    console.log(
      `Client ${id} connected as ${role}${
        kind ? `/${kind}` : ""
      }${index !== null ? ` (index ${index})` : ""}${
        offered === id ? " - reused id" : ""
      }`
    );

    this.send(socket, {
      type: "assigned",
      clientId: id,
      index,
      role,
      deviceKind: kind,
    });
    const enabledForNew = this.isIdEnabled(id);
    this.send(socket, {
      type: "state",
      state: enabledForNew ? this.control.state : null,
    });
    this.send(socket, {
      type: "beat",
      beat: enabledForNew ? this.control.beat : null,
    });
    this.send(socket, {
      type: "enabled_kinds",
      enabled: this.control.enabledKinds,
    });
    if (role === "device") {
      this.broadcastDevices();
    } else {
      this.send(socket, { type: "devices", devices: this.devices() });
    }
  }

  /** non-device roles (conductor, observer) always see real state */
  private isIdEnabled(id: ClientId): boolean {
    const role = this.roleForId.get(id);
    if (role !== "device") return true;
    const kind = this.kindForId.get(id) ?? "audience";
    return this.control.enabledKinds[kind];
  }

  private broadcastState(state: MovementState) {
    for (const [id, socket] of this.clients) {
      if (socket.readyState !== socket.OPEN) continue;
      const effective = this.isIdEnabled(id) ? state : null;
      this.send(socket, { type: "state", state: effective });
    }
  }

  private broadcastMovementUpdate(
    id: MovementId,
    data: MovementData[MovementId],
  ) {
    const msg = {
      type: "movement_update",
      movement: id,
      data,
    } as ServerMessage;
    for (const [cid, socket] of this.clients) {
      if (socket.readyState !== socket.OPEN) continue;
      if (!this.isIdEnabled(cid)) continue;
      this.send(socket, msg);
    }
  }

  private broadcastBeat(beat: BeatState) {
    for (const [id, socket] of this.clients) {
      if (socket.readyState !== socket.OPEN) continue;
      const effective = this.isIdEnabled(id) ? beat : null;
      this.send(socket, { type: "beat", beat: effective });
    }
  }

  private handleEnabledKindsChange(enabled: EnabledKinds) {
    this.broadcast({ type: "enabled_kinds", enabled });
    this.broadcastState(this.control.state);
    this.broadcastBeat(this.control.beat);
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
      list.push({
        clientId,
        index,
        kind: this.kindForId.get(clientId) ?? "audience",
      });
    }
    list.sort((a, b) => a.index - b.index);
    return list;
  }

  private broadcastDevices() {
    this.broadcast({ type: "devices", devices: this.devices() });
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

function parseAndVerifyTokenFromUrl(url: string | undefined): VerifiedClaim | null {
  if (!url) return null;
  // req.url is a path-only URL ("/ws?token=..."); URL needs an origin
  // localhost'll have to do! :)
  const parsed = new URL(url, "http://localhost");
  const token = parsed.searchParams.get("token");
  if (!token) return null;
  return verifyAccess(token);
}

function deriveRoleAndKind(
  claim: VerifiedClaim | null,
  offeredRole: ClientRole | undefined,
): { role: ClientRole; kind: DeviceKind | null } {
  if (offeredRole === "observer") {
    return { role: "observer", kind: null };
  }
  if (claim?.role === "conductor") {
    if (offeredRole === "conductor") return { role: "conductor", kind: null };
    return { role: "device", kind: "member" };
  }
  if (claim?.role === "member") {
    return { role: "device", kind: "member" };
  }
  return { role: "device", kind: "audience" };
}
