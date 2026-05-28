import dgram from "node:dgram";
import { encode, type OscArg } from "./shared.js";

const OSC_PORT_STATION = Number(process.env.OSC_PORT_STATION ?? 5461);

const sock = dgram.createSocket("udp4");
sock.on("error", (err) =>
  console.error("[osc-send] socket error:", err.message),
);

let oscReady = false;
sock.bind(0, () => {
  oscReady = true;
  console.log(`[osc-send] ready, sending to :${OSC_PORT_STATION}`);
});

export function osend(
  address: string,
  args: OscArg[] = [],
  deviceAddresses: string[] = [],
) {
  if (!oscReady) return;
  if (deviceAddresses.length === 0) return;

  const buf = encode(address, args);
  for (const deviceAddr of deviceAddresses) {
    sock.send(buf, OSC_PORT_STATION, deviceAddr, (err) => {
      if (err) {
        console.error(`[osc-send] send error to ${deviceAddr}:`, err.message);
      }
    });
  }
}
