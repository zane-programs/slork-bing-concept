// TLS-terminating sidecar: serves HTTPS on HTTPS_PORT and proxies everything
// (including WebSocket upgrades, so Vite HMR + the /ws proxy keep working) to
// the plain-HTTP Vite dev server on TARGET_PORT.
//
// Run `npm run dev` and `npm run dev:https` in two terminals (or `npm run dev:all`).

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import httpProxy from "http-proxy";
import selfsigned from "selfsigned";

const TARGET_PORT = Number(process.env.TARGET_PORT ?? 5173);
const TARGET_HOST = process.env.TARGET_HOST ?? "localhost";
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 5175);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(
  __dirname,
  "..",
  "node_modules",
  ".cache",
  "https-sidecar"
);
const CERT_PATH = path.join(CERT_DIR, "cert.pem");
const KEY_PATH = path.join(CERT_DIR, "key.pem");

async function loadOrCreateCert() {
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    return { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) };
  }
  const pems = await selfsigned.generate(
    [{ name: "commonName", value: "localhost" }],
    {
      days: 365,
      keySize: 2048,
      extensions: [
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
          ],
        },
      ],
    }
  );
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CERT_PATH, pems.cert);
  fs.writeFileSync(KEY_PATH, pems.private);
  return { cert: pems.cert, key: pems.private };
}

const { cert, key } = await loadOrCreateCert();

const proxy = httpProxy.createProxyServer({
  target: `http://${TARGET_HOST}:${TARGET_PORT}`,
  ws: true,
  changeOrigin: false,
  xfwd: true,
});

proxy.on("error", (err, _req, res) => {
  console.error(`[https-sidecar] proxy error: ${err.message}`);
  if (res && !res.headersSent && typeof res.writeHead === "function") {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(
      `sidecar: upstream http://${TARGET_HOST}:${TARGET_PORT} unreachable\n`
    );
  } else if (res && typeof res.destroy === "function") {
    res.destroy();
  }
});

const server = https.createServer({ cert, key }, (req, res) =>
  proxy.web(req, res)
);
server.on("upgrade", (req, socket, head) => proxy.ws(req, socket, head));

server.listen(HTTPS_PORT, "0.0.0.0", () => {
  console.log(
    `[https-sidecar] https://localhost:${HTTPS_PORT}  →  http://${TARGET_HOST}:${TARGET_PORT}`
  );
  console.log(
    `[https-sidecar] LAN access: https://<your-192.168.x.x>:${HTTPS_PORT} (accept the self-signed cert warning)`
  );
});
