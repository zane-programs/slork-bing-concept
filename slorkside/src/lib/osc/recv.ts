import dgram from "node:dgram";
import { encode, readInt32, readString } from "./shared.js";
import { EventEmitter } from "node:events";

// port the bridge listens on for inbound station messages (registration
// pings). distinct env var from OSC_PORT_STATION so the two can't collide
// when overridden — bind port and reply port must stay different.
const OSC_PORT_BRIDGE = Number(process.env.OSC_PORT_BRIDGE ?? 5462);
const OSC_PORT_STATION = Number(process.env.OSC_PORT_STATION ?? 5461);

export interface RegistrationRequest {
  idx: number;
  address: string;
}

export interface OscReceiver {
  on(event: "register", listener: (req: RegistrationRequest) => void): this;
  off(event: "register", listener: (req: RegistrationRequest) => void): this;
  once(event: "register", listener: (req: RegistrationRequest) => void): this;
  addListener(
    event: "register",
    listener: (req: RegistrationRequest) => void,
  ): this;
  removeListener(
    event: "register",
    listener: (req: RegistrationRequest) => void,
  ): this;
  emit(event: "register", req: RegistrationRequest): boolean;
}

export class OscReceiver extends EventEmitter {
  private sock: dgram.Socket;

  constructor() {
    super();

    this.sock = dgram.createSocket("udp4");
    this.sock.on("message", (msg, rinfo) => {
      this.handleMessage(msg, rinfo);
    });
    this.sock.on("listening", () => {
      const { address, port } = this.sock.address();
      this.log(`server listening on ${address}:${port}`);
    });

    this.sock.bind(OSC_PORT_BRIDGE);
  }

  private handleMessage(msg: NonSharedBuffer, rinfo: dgram.RemoteInfo) {
    this.log("message received");

    const { val: address, nextOffset: ttOffset } = readString(msg);
    const { val: typeTag, nextOffset: dataOffset } = readString(msg, ttOffset);

    if (address === "/register/ping" && typeTag === ",i") {
      const { val: deviceIdx } = readInt32(msg, dataOffset);
      this.log(`register ping from device ${deviceIdx} (${rinfo.address})`);

      // event for EventEmitter
      this.emit("register", {
        idx: deviceIdx,
        address: rinfo.address,
      });
      // reply for slorkstation client
      this.reply(rinfo.address, "/register/pong", [
        { type: "i", value: deviceIdx },
      ]);
    }
  }

  private reply(
    host: string,
    address: string,
    args: Parameters<typeof encode>[1],
  ) {
    const buf = encode(address, args);
    this.sock.send(buf, OSC_PORT_STATION, host, (err) => {
      if (err) this.log("reply error:", err.message);
    });
  }

  private log(...args: Parameters<typeof console.log>) {
    console.log("[osc-recv]", ...args);
  }
}
