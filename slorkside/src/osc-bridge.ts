import { BridgeServer } from "./lib/server.js";

const WS_PORT = Number(process.env.WS_PORT ?? 3124);
const WS_PATH = process.env.WS_PATH ?? "/ws";
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 500);

new BridgeServer({
  port: WS_PORT,
  path: WS_PATH,
  heartbeatMs: HEARTBEAT_MS,
});
