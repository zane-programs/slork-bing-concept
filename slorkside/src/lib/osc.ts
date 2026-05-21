// heavy thanks to dr. matt et al for this epic protocol
// https://ccrma.stanford.edu/groups/osc/spec-1_0.html

import dgram from "node:dgram";

const OSC_PORT = Number(process.env.OSC_PORT ?? 5461);
const OSC_BROADCAST = process.env.OSC_BROADCAST ?? "255.255.255.255";

type OscArg =
  | { type: "i"; value: number }
  | { type: "f"; value: number }
  | { type: "s"; value: string };

function pad4(buf: Buffer): Buffer {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

// OSC strings are null-terminated then padded to a 4-byte boundary.
function ostr(s: string): Buffer {
  return pad4(Buffer.from(s + "\0", "utf8"));
}

function encode(address: string, args: OscArg[]): Buffer {
  const parts: Buffer[] = [
    ostr(address),
    ostr("," + args.map((a) => a.type).join("")),
  ];
  for (const a of args) {
    if (a.type === "i") {
      const b = Buffer.alloc(4);
      b.writeInt32BE(Math.trunc(a.value), 0);
      parts.push(b);
    } else if (a.type === "f") {
      const b = Buffer.alloc(4);
      b.writeFloatBE(a.value, 0);
      parts.push(b);
    } else {
      parts.push(ostr(a.value));
    }
  }
  return Buffer.concat(parts);
}

const sock = dgram.createSocket("udp4");
sock.on("error", (err) => console.error("[osc] socket error:", err.message));

let oscReady = false;
sock.bind(0, () => {
  sock.setBroadcast(true);
  oscReady = true;
  console.log(`[osc] broadcasting to ${OSC_BROADCAST}:${OSC_PORT}`);
});

export function osend(address: string, args: OscArg[] = []) {
  if (!oscReady) return;
  const buf = encode(address, args);
  sock.send(buf, OSC_PORT, OSC_BROADCAST, (err) => {
    if (err) console.error("[osc] send error:", err.message);
  });
}
