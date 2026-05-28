import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";

const NS_PER_SEC = 1_000_000_000n;
const NS_PER_MS = 1_000_000n;

export interface MetronomeBeat {
  /** 0-based, increments per beat since start() */
  beatIndex: number;
  /** target hrtime ns at which this beat was supposed to fire */
  scheduledHrNs: bigint;
  /** hctual hrtime ns at which the listener was invoked */
  firedHrNs: bigint;
  /** firedHrNs - scheduledHrNs. Positive means we fired late */
  driftNs: bigint;
  bpm: number;
}

export interface MetronomeOptions {
  bpm?: number;
  /** spin threshold in ms */
  precisionWindowMs?: number;
}

export interface Metronome {
  on(event: "beat", listener: (beat: MetronomeBeat) => void): this;
  off(event: "beat", listener: (beat: MetronomeBeat) => void): this;
  once(event: "beat", listener: (beat: MetronomeBeat) => void): this;
  addListener(event: "beat", listener: (beat: MetronomeBeat) => void): this;
  removeListener(event: "beat", listener: (beat: MetronomeBeat) => void): this;
  emit(event: "beat", beat: MetronomeBeat): boolean;
}

export class Metronome extends EventEmitter {
  private _bpm: number;
  private readonly precisionWindowNs: bigint;

  private running = false;
  // Bumped on start()/stop(); tick() exits early if it races a generation change.
  private generation = 0;

  /** hrtime ns of the next beat to fire. */
  private nextBeatHrNs = 0n;
  private nextBeatIndex = 0;

  private pendingTimeout: NodeJS.Timeout | null = null;
  private pendingImmediate: NodeJS.Immediate | null = null;

  constructor(opts: MetronomeOptions = {}) {
    super();
    this._bpm = Metronome.checkBpm(opts.bpm ?? 120);

    const pw = opts.precisionWindowMs ?? 8;
    if (typeof pw !== "number" || !Number.isFinite(pw) || pw <= 0) {
      throw new RangeError(
        `precisionWindowMs must be a finite positive number, got ${pw}`,
      );
    }
    this.precisionWindowNs = BigInt(Math.max(1, Math.round(pw))) * NS_PER_MS;
  }

  get bpm(): number {
    return this._bpm;
  }

  setBpm(bpm: number): void {
    this._bpm = Metronome.checkBpm(bpm);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    const now = process.hrtime.bigint();
    this.nextBeatHrNs = now;
    this.nextBeatIndex = 0;
    // start immediately
    this.tick();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    this.cancelPending();
  }

  private cancelPending(): void {
    if (this.pendingTimeout !== null) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    if (this.pendingImmediate !== null) {
      clearImmediate(this.pendingImmediate);
      this.pendingImmediate = null;
    }
  }

  // millibpm precision so fractional tempos round-trip
  // cleanly, max 1ns error per beat
  private nsPerBeat(): bigint {
    const milliBpm = BigInt(Math.round(this._bpm * 1000));
    return (60n * NS_PER_SEC * 1000n) / milliBpm;
  }

  private tick(): void {
    const myGen = this.generation;
    while (this.running && this.generation === myGen) {
      const now = process.hrtime.bigint();

      if (now >= this.nextBeatHrNs) {
        const scheduled = this.nextBeatHrNs;
        const event: MetronomeBeat = {
          beatIndex: this.nextBeatIndex,
          scheduledHrNs: scheduled,
          firedHrNs: now,
          driftNs: now - scheduled,
          bpm: this._bpm,
        };

        this.nextBeatIndex += 1;
        this.nextBeatHrNs = scheduled + this.nsPerBeat();

        this.emit("beat", event);
        continue;
      }

      const delta = this.nextBeatHrNs - now;
      if (delta <= this.precisionWindowNs) {
        this.pendingImmediate = setImmediate(() => {
          this.pendingImmediate = null;
          this.tick();
        });
      } else {
        // sleep until just inside the precision window, then spin
        const sleepNs = delta - this.precisionWindowNs;
        const sleepMs = Number(sleepNs / NS_PER_MS);
        this.pendingTimeout = setTimeout(() => {
          this.pendingTimeout = null;
          this.tick();
        }, Math.max(0, sleepMs));
      }
      return;
    }
  }

  private static checkBpm(bpm: number): number {
    if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm <= 0) {
      throw new RangeError(`bpm must be a finite positive number, got ${bpm}`);
    }
    return bpm;
  }
}