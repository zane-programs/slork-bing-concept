// heavy thanks to dr. matt et al for this epic protocol
// https://ccrma.stanford.edu/groups/osc/spec-1_0.html

export type OscArg =
  | { type: "i"; value: number }
  | { type: "f"; value: number }
  | { type: "s"; value: string };

function pad4(buf: Buffer): Buffer {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

// OSC strings are null-terminated then padded to a 4-byte boundary
function ostr(s: string): Buffer {
  return pad4(Buffer.from(s + "\0", "utf8"));
}

export function encode(address: string, args: OscArg[] = []): Buffer {
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

export function readString(buffer: Buffer, offset: number = 0) {
  let end = offset;
  while (buffer[end] !== 0x00) end++;

  const val = buffer.toString("utf8", offset, end);
  const lenRaw = end - offset + 1;
  const lenPadded = Math.ceil(lenRaw / 4) * 4;

  return { val, nextOffset: offset + lenPadded };
}

export function readInt32(buffer: Buffer, offset: number = 0) {
  return { val: buffer.readInt32BE(offset), nextOffset: offset + 4 };
}

export function readFloat32(buffer: Buffer, offset: number = 0) {
  return { val: buffer.readFloatBE(offset), nextOffset: offset + 4 };
}
