/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BeatState, ClientId, DeviceInfo } from "@shared/types";
import { getAudioCtx } from "./audio";
import styles from "./beat.module.css";

export interface BeatTick {
  beat: number;
  activeIndex: number;
  activeClientId: ClientId;
}

export interface ScheduledBeat {
  beat: number;
  audioTime: number;
  ctx: AudioContext;
  activeIndex: number;
  activeClientId: ClientId;
  isMine: boolean;
  myIndex: number | null;
  deviceCount: number;
  periodSec: number;
}

type Subscriber = (e: ScheduledBeat) => void;

interface BeatBus {
  subscribe: (s: Subscriber) => () => void;
}

const BeatBusContext = createContext<BeatBus | null>(null);

export function BeatProvider({
  bus,
  children,
}: {
  bus: BeatBus;
  children: React.ReactNode;
}) {
  return <BeatBusContext.Provider value={bus}>{children}</BeatBusContext.Provider>;
}

export function useBeatSubscription(cb: Subscriber): void {
  const bus = useContext(BeatBusContext);
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  }, [cb]);
  useEffect(() => {
    if (!bus) return;
    return bus.subscribe((e) => cbRef.current(e));
  }, [bus]);
}

interface UseBeatParams {
  beat: BeatState;
  devices: DeviceInfo[];
  getServerTime: () => number;
  myClientId: ClientId | null;
}

// https://web.dev/articles/audio-scheduling
const TICK_INTERVAL_MS = 25;
const LOOKAHEAD_SEC = 0.1;
const PAST_SKIP_SEC = 0.05;

interface Pending {
  beat: number;
  activeIndex: number;
  activeClientId: ClientId;
  audioTime: number | null;
  wallMs: number;
}

export function useBeat({
  beat,
  devices,
  getServerTime,
  myClientId,
}: UseBeatParams) {
  const [tick, setTick] = useState<BeatTick | null>(null);

  const devicesRef = useRef(devices);
  const myIdRef = useRef(myClientId);
  const beatRef = useRef<BeatState>(beat);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);
  useEffect(() => {
    myIdRef.current = myClientId;
  }, [myClientId]);
  useEffect(() => {
    beatRef.current = beat;
    if (!beat) setTick(null);
  }, [beat]);

  const subscribersRef = useRef<Set<Subscriber>>(new Set());
  const subscribe = useCallback<BeatBus["subscribe"]>((s) => {
    subscribersRef.current.add(s);
    return () => {
      subscribersRef.current.delete(s);
    };
  }, []);
  const bus = useMemo<BeatBus>(() => ({ subscribe }), [subscribe]);

  useEffect(() => {
    let nextBeat = Number.NaN;
    let lastSeenAnchor = Number.NaN;
    let lastSeenOrigin = Number.NaN;
    let lastDispatchedBeat = Number.NEGATIVE_INFINITY;
    const pending: Pending[] = [];
    let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
    let visualRaf = 0;

    const activeFor = (b: number): DeviceInfo | null => {
      const list = devicesRef.current;
      if (list.length === 0) return null;
      const slot = ((b % list.length) + list.length) % list.length;
      return list[slot];
    };
    const findMyIndex = (): number | null => {
      const myId = myIdRef.current;
      if (!myId) return null;
      const self = devicesRef.current.find((d) => d.clientId === myId);
      return self ? self.index : null;
    };

    const schedulerTick = () => {
      const b = beatRef.current;
      if (!b) {
        nextBeat = Number.NaN;
        lastSeenAnchor = Number.NaN;
        lastSeenOrigin = Number.NaN;
        lastDispatchedBeat = Number.NEGATIVE_INFINITY;
        pending.length = 0;
        schedulerTimer = setTimeout(schedulerTick, TICK_INTERVAL_MS);
        return;
      }

      const { anchorMs, bpm } = b;
      const originBeat = b.originBeat ?? 0;
      const periodSec = 60 / bpm;
      const periodMs = 60_000 / bpm;

      if (!Number.isNaN(lastSeenOrigin) && originBeat < lastSeenOrigin) {
        lastDispatchedBeat = Number.NEGATIVE_INFINITY;
        nextBeat = Number.NaN;
      }

      const scheduleChanged =
        anchorMs !== lastSeenAnchor || originBeat !== lastSeenOrigin;

      const ctx = getAudioCtx();
      const audioOn = ctx !== null && ctx.state === "running";
      const serverNow = getServerTime();
      const anchorAudioSec = audioOn
        ? ctx!.currentTime - (serverNow - anchorMs) / 1000
        : 0;
      const audioNow = audioOn ? ctx!.currentTime : 0;

      if (Number.isNaN(nextBeat) || scheduleChanged) {
        const beatsSinceAnchor = Math.floor((serverNow - anchorMs) / periodMs);
        const minNext = originBeat + Math.max(0, beatsSinceAnchor);
        nextBeat = Number.isNaN(nextBeat)
          ? minNext
          : Math.max(nextBeat, minNext);
        lastSeenAnchor = anchorMs;
        lastSeenOrigin = originBeat;
      }

      const audioCutoff = audioNow + LOOKAHEAD_SEC;
      const wallCutoff = serverNow + LOOKAHEAD_SEC * 1000;

      while (true) {
        if (nextBeat <= lastDispatchedBeat) {
          nextBeat = lastDispatchedBeat + 1;
        }
        const stepsFromOrigin = nextBeat - originBeat;
        const wallMs = anchorMs + stepsFromOrigin * periodMs;
        const audioTime = audioOn ? anchorAudioSec + stepsFromOrigin * periodSec : null;

        const past = audioOn
          ? audioTime! < audioNow - PAST_SKIP_SEC
          : wallMs < serverNow - PAST_SKIP_SEC * 1000;
        if (past) {
          nextBeat++;
          continue;
        }
        const futureBeyondLookahead = audioOn
          ? audioTime! >= audioCutoff
          : wallMs >= wallCutoff;
        if (futureBeyondLookahead) break;

        const active = activeFor(nextBeat);
        if (active === null) break;

        if (audioOn && audioTime !== null) {
          const event: ScheduledBeat = {
            beat: nextBeat,
            audioTime,
            ctx: ctx!,
            activeIndex: active.index,
            activeClientId: active.clientId,
            isMine: active.clientId === myIdRef.current,
            myIndex: findMyIndex(),
            deviceCount: devicesRef.current.length,
            periodSec,
          };
          for (const s of Array.from(subscribersRef.current)) s(event);
          lastDispatchedBeat = nextBeat;
        }

        pending.push({
          beat: nextBeat,
          activeIndex: active.index,
          activeClientId: active.clientId,
          audioTime,
          wallMs,
        });
        nextBeat++;
      }

      schedulerTimer = setTimeout(schedulerTick, TICK_INTERVAL_MS);
    };

    const visualLoop = () => {
      const ctx = getAudioCtx();
      const audioNow = ctx ? ctx.currentTime : null;
      const wallNow = getServerTime();
      while (pending.length > 0) {
        const head = pending[0];
        const due =
          head.audioTime !== null && audioNow !== null
            ? head.audioTime <= audioNow
            : head.wallMs <= wallNow;
        if (!due) break;
        pending.shift();
        setTick({
          beat: head.beat,
          activeIndex: head.activeIndex,
          activeClientId: head.activeClientId,
        });
      }
      visualRaf = requestAnimationFrame(visualLoop);
    };

    schedulerTick();
    visualRaf = requestAnimationFrame(visualLoop);

    return () => {
      if (schedulerTimer !== null) clearTimeout(schedulerTimer);
      cancelAnimationFrame(visualRaf);
    };
  }, [getServerTime]);

  const isActive = tick !== null && tick.activeClientId === myClientId;
  return { tick, isActive, bus };
}

interface BeatIndicatorProps {
  tick: BeatTick | null;
  isActive: boolean;
  myIndex: number | null;
  bpm: number | null;
}

export function BeatIndicator({
  tick,
  isActive,
  myIndex,
  bpm,
}: BeatIndicatorProps) {
  if (tick === null || bpm === null) {
    return (
      <div className={styles.panel}>
        <p className={styles.idle}>
          beat: idle{myIndex !== null ? ` · you are #${myIndex}` : ""}
        </p>
      </div>
    );
  }
  return (
    <div
      className={
        isActive ? `${styles.panel} ${styles.panelActive}` : styles.panel
      }
    >
      <div className={styles.row}>
        <span
          key={tick.beat}
          className={isActive ? `${styles.dot} ${styles.dotActive}` : styles.dot}
        />
        <div className={styles.info}>
          <div>
            beat #{tick.beat} → device #{tick.activeIndex}
            {bpm !== null ? ` @ ${bpm} bpm` : ""}
          </div>
          <div className={styles.subInfo}>
            {isActive
              ? "YOUR TURN"
              : myIndex !== null
              ? `you are #${myIndex}`
              : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
