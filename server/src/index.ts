import http from "node:http";
import express from "express";
import cors from "cors";
import SocketManager from "./manager.js";

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

const server = http.createServer(app);
new SocketManager(server);

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  console.log(`ws://localhost:${PORT}/ws`);
});
