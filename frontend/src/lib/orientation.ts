// app-scoped DeviceOrientation singleton; listener attaches once per session
// and beta/gamma refs stay live until the page closes

export type OrientationStatus =
  | "needs-permission"
  | "granted"
  | "denied"
  | "unsupported";

interface DOEWithPermission {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
}

// long enough for android's first tick, short enough that desktop falls through
const PROBE_MS = 1500;

const betaRef = { current: 0 };
const gammaRef = { current: 0 };

let status: OrientationStatus = "unsupported";
let listenerAttached = false;
let sawReading = false;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<(s: OrientationStatus) => void>();

function setStatus(next: OrientationStatus) {
  if (status === next) return;
  status = next;
  for (const sub of Array.from(subs)) sub(next);
}

function handleOrientation(e: DeviceOrientationEvent) {
  // beta = front-back, gamma = left-right
  if (e.beta !== null) betaRef.current = e.beta;
  if (e.gamma !== null) gammaRef.current = e.gamma;
  if (!sawReading && (e.beta !== null || e.gamma !== null)) {
    sawReading = true;
    if (probeTimer !== null) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    setStatus("granted");
  }
}

function attach() {
  if (listenerAttached) return;
  if (typeof window === "undefined") return;
  listenerAttached = true;
  window.addEventListener("deviceorientation", handleOrientation);
  // no reading in the probe window means the platform doesn't deliver orientation
  probeTimer = setTimeout(() => {
    if (!sawReading) setStatus("unsupported");
  }, PROBE_MS);
}

// module-load detection: ios gates behind requestPermission, everyone else can attach
if (
  typeof window !== "undefined" &&
  typeof window.DeviceOrientationEvent !== "undefined"
) {
  const Ctor = window.DeviceOrientationEvent as unknown as DOEWithPermission;
  if (typeof Ctor.requestPermission === "function") {
    status = "needs-permission";
  } else {
    attach();
  }
}

// must be called inside a user-gesture handler; resolves with status=denied on reject
export async function requestOrientationPermission(): Promise<void> {
  if (typeof window === "undefined") return;
  if (listenerAttached) return;
  if (typeof window.DeviceOrientationEvent === "undefined") {
    setStatus("unsupported");
    return;
  }
  const Ctor = window.DeviceOrientationEvent as unknown as DOEWithPermission;
  if (typeof Ctor.requestPermission !== "function") {
    attach();
    return;
  }
  try {
    // ios needs requestPermission called sync in the gesture; callers fire-and-forget so await is safe
    const result = await Ctor.requestPermission();
    if (result === "granted") {
      attach();
    } else {
      setStatus("denied");
    }
  } catch {
    setStatus("denied");
  }
}

// live tilt refs; read .current per tick
export function getOrientationRefs(): {
  betaRef: { current: number };
  gammaRef: { current: number };
} {
  return { betaRef, gammaRef };
}

export function getOrientationStatus(): OrientationStatus {
  return status;
}

export function subscribeOrientationStatus(
  cb: (s: OrientationStatus) => void
): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
