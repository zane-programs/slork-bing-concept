import http from "node:http";
import express from "express";
import cors from "cors";
import SocketManager from "./manager.js";
import { checkPasscode } from "./member-auth.js";
import { mintPair, verifyRefresh, type TokenRole } from "./tokens.js";

const PORT = Number(process.env.PORT ?? 3123);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).send("slorking it rn");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// passcode auth, generates jwt pair (auth & refresh)
function handlePasscodeAuth(role: TokenRole) {
  return (req: express.Request, res: express.Response): void => {
    if (!checkPasscode(req.body?.passcode)) {
      res.status(401).json({ ok: false });
      return;
    }
    res.json({ ok: true, ...mintPair(role) });
  };
}

app.post("/auth/member", handlePasscodeAuth("member"));
app.post("/auth/conductor", handlePasscodeAuth("conductor"));

app.post("/auth/refresh", (req, res) => {
  const claim = verifyRefresh(req.body?.refreshToken);
  if (!claim) {
    res.status(401).json({ ok: false });
    return;
  }
  // refresh rotates both tokens
  res.json({ ok: true, ...mintPair(claim.role) });
});

const server = http.createServer(app);
new SocketManager(server, "/ws");

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  console.log(`ws://localhost:${PORT}/ws`);
});
