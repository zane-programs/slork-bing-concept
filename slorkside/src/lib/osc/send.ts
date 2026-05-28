import dgram from "node:dgram";
import { encode, type OscArg } from "./shared.js";

// port the SLOrkstations are listening on (recv.ts shares this constant
// under the same env var so a reply lands on the right port). don't reuse
// OSC_PORT for the bridge's own receive port - that's OSC_PORT_BRIDGE in
// recv.ts; collapsing the two onto a single env var would make both
// processes try to talk on the same port if anyone overrode it.
const OSC_PORT_STATION = Number(process.env.OSC_PORT_STATION ?? 5461);
const OSC_BROADCAST = process.env.OSC_BROADCAST ?? "255.255.255.255";

const sock = dgram.createSocket("udp4");
sock.on("error", (err) => console.error("[osc-send] socket error:", err.message));

let oscReady = false;
sock.bind(0, () => {
  sock.setBroadcast(true);
  oscReady = true;
  console.log(`[osc-send] broadcasting to ${OSC_BROADCAST}:${OSC_PORT_STATION}`);
});

export function osend(address: string, args: OscArg[] = []) {
  if (!oscReady) return;
  const buf = encode(address, args);
  sock.send(buf, OSC_PORT_STATION, OSC_BROADCAST, (err) => {
    if (err) console.error("[osc-send] send error:", err.message);
  });
}
