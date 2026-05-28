import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { ControlState } from "@shared/control.js";

import type {
  BeatState,
  ClientId,
  ClientMessage,
  ClientRole,
  MovementData,
  MovementId,
  MovementState,
  ServerMessage,
} from "@shared/types.js";

import { Metronome, type MetronomeBeat } from "./metronome.js";
import { osend } from "./osc/send.js";
import { OscReceiver } from "./osc/recv.js";

const NOTE_TO_PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

function pitchClassMask(names: string[] | undefined): number {
  let mask = 0;
  for (const n of names ?? []) {
    const pc = NOTE_TO_PC[n];
    if (pc !== undefined) mask |= 1 << pc;
  }
  return mask;
}

function emitMovement(
  id: MovementId,
  data: MovementData[MovementId],
  deviceAddresses: string[],
) {
  console.log("emitMovement", deviceAddresses);
  if (id === "wake") {
    const d = data as MovementData["wake"];
    osend(
      "/movement/wake",
      [
        { type: "f", value: d.gain },
        { type: "i", value: pitchClassMask(d.activeNoteNames) },
      ],
      deviceAddresses,
    );
  } else if (id === "turn") {
    const d = data as MovementData["turn"];
    osend(
      "/movement/turn",
      [
        { type: "f", value: d.gain },
        { type: "s", value: (d.activeNoteNames ?? []).join(",") },
        { type: "i", value: d.octave },
        { type: "f", value: d.vibratoMaxCents },
        { type: "f", value: d.timbreAmount },
      ],
      deviceAddresses,
    );
  } else if (id === "clicking") {
    const d = data as MovementData["clicking"];
    osend(
      "/movement/clicking",
      [
        { type: "f", value: d.gain },
        { type: "f", value: d.intensity },
      ],
      deviceAddresses,
    );
  } else if (id === "counting") {
    const d = data as MovementData["counting"];
    osend(
      "/movement/counting",
      [
        { type: "i", value: d.n },
        { type: "f", value: d.gain },
        { type: "f", value: d.pitchMultiply },
      ],
      deviceAddresses,
    );
  }
}

function emitState(state: MovementState, deviceAddresses: string[]) {
  if (!state) {
    osend("/state/none", [], deviceAddresses);
    return;
  }
  osend(
    "/state/movement",
    [{ type: "s", value: state.movement }],
    deviceAddresses,
  );
  emitMovement(state.movement, state.data, deviceAddresses);
}

function emitBeat(beat: BeatState, deviceAddresses: string[]) {
  if (!beat) {
    osend("/beatinfo/clear", [], deviceAddresses);
    return;
  }
  osend(
    "/beatinfo",
    [
      // NOTE: i am sending anchorMs as a string!
      { type: "s", value: String(beat.anchorMs) },
      { type: "f", value: beat.bpm },
      { type: "i", value: beat.originBeat ?? 0 },
    ],
    deviceAddresses,
  );
}

export interface BridgeServerOptions {
  port: number;
  path?: string;
  heartbeatMs?: number;
}

export class BridgeServer {
  private control = new ControlState();
  private wss: WebSocketServer;
  private httpServer: http.Server;
  private clients = new Map<ClientId, WebSocket>();
  private roleForId = new Map<ClientId, ClientRole>();
  private idForSocket = new WeakMap<WebSocket, ClientId>();

  private oscClients = new Map<number, string>();
  private oscLastSeen = new Map<number, number>();
  private static readonly STATION_TTL_MS = 3000;
  private oscReceiver = new OscReceiver();

  private metronome = new Metronome();

  constructor(opts: BridgeServerOptions) {
    const path = opts.path ?? "/ws";
    const heartbeatMs = opts.heartbeatMs ?? 500;

    this.httpServer = http.createServer((req, res) =>
      this.handleHttp(req, res),
    );
    this.wss = new WebSocketServer({ server: this.httpServer, path });
    this.wss.on("connection", (s) => this.handleConnection(s));

    this.control.onStateChange((state) => {
      this.emitStateGated(state);
      this.broadcast({ type: "state", state });
    });
    this.control.onMovementUpdate((id, data) => {
      this.emitMovementGated(id, data);
      this.broadcast({
        type: "movement_update",
        movement: id,
        data,
      } as ServerMessage);
    });
    this.control.onBeatChange((beat) => {
      this.emitBeatGated(beat);
      this.broadcast({ type: "beat", beat });
      if (beat) {
        // setBpm before start so beat 0 uses the new tempo, not the default.
        this.metronome.setBpm(beat.bpm);
        this.metronome.start();
      } else {
        this.metronome.stop();
      }
    });
    this.control.onEnabledKindsChange((enabled) => {
      // replay state on enable so ChucK stations catch up; clear on disable.
      if (enabled.slorkstation) {
        this.emitState(this.control.state);
        this.emitBeat(this.control.beat);
      } else {
        this.emitState(null);
        this.emitBeat(null);
      }
      this.broadcast({ type: "enabled_kinds", enabled });
    });

    this.oscReceiver.on("register", ({ idx, address }) => {
      this.handleOscRegister(idx, address);
    });

    this.metronome.on("beat", (beat) => {
      this.handleMetronomeBeat(beat);
    });

    setInterval(() => {
      if (!this.control.enabledKinds.slorkstation) return;
      this.emitState(this.control.state);
      this.emitBeat(this.control.beat);
    }, heartbeatMs);

    setInterval(() => {
      const now = Date.now();
      for (const [idx, last] of this.oscLastSeen) {
        if (now - last > BridgeServer.STATION_TTL_MS) {
          this.oscClients.delete(idx);
          this.oscLastSeen.delete(idx);
          console.log(`[bridge] station ${idx} evicted (silent ${now - last}ms)`);
        }
      }
    }, 1000);

    this.httpServer.listen(opts.port, () => {
      console.log(`[bridge] http  http://localhost:${opts.port}`);
      console.log(`[bridge] ws    ws://localhost:${opts.port}${path}`);
    });
  }

  private emitState(state: MovementState) {
    emitState(state, Array.from(this.oscClients.values()));
  }

  private emitMovement(id: MovementId, data: MovementData[MovementId]) {
    emitMovement(id, data, Array.from(this.oscClients.values()));
  }

  private emitBeat(beat: BeatState) {
    emitBeat(beat, Array.from(this.oscClients.values()));
  }

  private slorkstationEnabled(): boolean {
    return this.control.enabledKinds.slorkstation;
  }

  private emitStateGated(state: MovementState) {
    if (!this.slorkstationEnabled()) return;
    this.emitState(state);
  }

  private emitMovementGated(id: MovementId, data: MovementData[MovementId]) {
    if (!this.slorkstationEnabled()) return;
    this.emitMovement(id, data);
  }

  private emitBeatGated(beat: BeatState) {
    if (!this.slorkstationEnabled()) return;
    this.emitBeat(beat);
  }

  private handleOscRegister(idx: number, address: string) {
    this.oscClients.set(idx, address);
    this.oscLastSeen.set(idx, Date.now());
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          uptime: process.uptime(),
          clients: this.wss.clients.size,
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          state: this.control.state,
          beat: this.control.beat,
          enabledKinds: this.control.enabledKinds,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  }

  private handleConnection(socket: WebSocket) {
    console.log("[bridge] client connected (awaiting hello)");

    socket.on("message", (raw) => {
      const t1 = Date.now();
      const msg = this.parse(raw.toString());
      if (!msg) return;
      this.handleClientMessage(socket, msg, t1);
    });

    socket.on("close", () => {
      const id = this.idForSocket.get(socket);
      if (id && this.clients.get(id) === socket) {
        this.clients.delete(id);
        this.roleForId.delete(id);
        console.log(`[bridge] client ${id} disconnected`);
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
    t1: number,
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
    // mirror the cloud server, only the conductor can drive control changes
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
    const role: ClientRole =
      offeredRole === "conductor"
        ? "conductor"
        : offeredRole === "observer"
        ? "observer"
        : "device";

    const existing = this.idForSocket.get(socket);
    if (existing) {
      const existingRole = this.roleForId.get(existing) ?? "device";
      this.send(socket, {
        type: "assigned",
        clientId: existing,
        index: null,
        role: existingRole,
        deviceKind: null,
      });
      this.send(socket, { type: "state", state: this.control.state });
      this.send(socket, { type: "beat", beat: this.control.beat });
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
    this.clients.set(id, socket);
    this.roleForId.set(id, role);
    this.idForSocket.set(socket, id);
    console.log(`[bridge] client ${id} hello as ${role}`);

    this.send(socket, {
      type: "assigned",
      clientId: id,
      index: null,
      role,
      deviceKind: null,
    });
    this.send(socket, { type: "state", state: this.control.state });
    this.send(socket, { type: "beat", beat: this.control.beat });
    this.send(socket, {
      type: "enabled_kinds",
      enabled: this.control.enabledKinds,
    });
  }

  // Round-robins beats across registered stations; each station filters /beatmetro by target_idx.
  private handleMetronomeBeat(beat: MetronomeBeat) {
    if (!this.slorkstationEnabled()) return;
    if (this.oscClients.size === 0) return;
    const indices = [...this.oscClients.keys()].sort((a, b) => a - b);
    const targetIdx = indices[beat.beatIndex % indices.length];
    console.log("Beat for device", targetIdx);
    osend(
      "/beatmetro",
      [
        { type: "i", value: targetIdx },
        { type: "i", value: beat.beatIndex },
        { type: "f", value: beat.bpm },
      ],
      Array.from(this.oscClients.values()),
    );
  }

  private send(socket: WebSocket, msg: ServerMessage) {
    socket.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage) {
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }
}
