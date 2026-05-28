export const SOCKET_URL_BASE =
  import.meta.env.VITE_SOCKET_URL ||
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host;

export const BRIDGE_URL =
  import.meta.env.VITE_BRIDGE_URL || "ws://localhost:3124/ws";

export const CLIENT_ID_STORAGE_KEY = "slork.clientId";
export const MEMBER_TOKENS_STORAGE_KEY = "slork.tokens.member";
export const CONDUCTOR_TOKENS_STORAGE_KEY = "slork.tokens.conductor";
