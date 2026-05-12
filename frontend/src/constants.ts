export const SOCKET_URL_BASE =
  import.meta.env.VITE_SOCKET_URL ||
  "ws://" + window.location.hostname + ":3123";

export const CLIENT_ID_STORAGE_KEY = "slork.clientId";
