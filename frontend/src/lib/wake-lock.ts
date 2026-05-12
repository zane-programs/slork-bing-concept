import { useCallback, useEffect, useRef, useState } from "react";
import NoSleep from "nosleep.js";

export function useWakeLock() {
  const noSleepRef = useRef<NoSleep | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const acquire = useCallback(async () => {
    if (typeof window === "undefined") return;

    if (!noSleepRef.current) noSleepRef.current = new NoSleep();
    const noSleep = noSleepRef.current;
    if (noSleep.isEnabled) return;

    try {
      await noSleep.enable();
      setIsLocked(true);
    } catch (err) {
      console.warn("wake lock request failed:", err);
    }
  }, []);

  const release = useCallback(async () => {
    const noSleep = noSleepRef.current;
    if (!noSleep) {
      setIsLocked(false);
      return;
    }

    try {
      if (noSleep.isEnabled) noSleep.disable();
    } catch (err) {
      console.warn("wake lock release failed:", err);
    }
    setIsLocked(false);
  }, []);

  useEffect(() => {
    return () => {
      const noSleep = noSleepRef.current;
      noSleepRef.current = null;
      if (noSleep?.isEnabled) {
        try {
          noSleep.disable();
        } catch (err) {
          console.warn("wake lock cleanup failed:", err);
        }
      }
    };
  }, []);

  return { acquire, release, isLocked };
}
