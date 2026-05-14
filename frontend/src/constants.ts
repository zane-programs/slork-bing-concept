export const SOCKET_URL_BASE =
  import.meta.env.VITE_SOCKET_URL ||
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host;

export const CLIENT_ID_STORAGE_KEY = "slork.clientId";
