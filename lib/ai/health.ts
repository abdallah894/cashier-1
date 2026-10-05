import type { ProviderErrorKind } from "./types";

/**
 * Per-provider circuit breaker. A failing provider is skipped (instead of
 * making every cashier wait for a timeout) until it has cooled down, then
 * one trial request is let through (half-open).
 *
 *  - quota / auth errors open the circuit immediately: retrying cannot help
 *    until the quota resets or the key is fixed.
 *  - unavailable / timeout / bad_response open it after `failureThreshold`
 *    failures inside `windowMs`.
 *
 * State is per server instance (serverless instances do not share memory);
 * that is acceptable because the worst case is one extra failed attempt per
 * instance, and checkout never depends on this.
 */
export type CircuitState = "closed" | "open" | "half_open";

export type HealthOptions = {
  failureThreshold?: number;
  windowMs?: number;
  cooldownMs?: number;
  authCooldownMs?: number;
  now?: () => number;
};

type Entry = { failures: number[]; openUntil: number; lastKind: ProviderErrorKind | null; trial: boolean };

export class ProviderHealth {
  private readonly entries = new Map<string, Entry>();
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly authCooldownMs: number;
  private readonly now: () => number;

  constructor(options: HealthOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.windowMs = options.windowMs ?? 60_000;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.authCooldownMs = options.authCooldownMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { failures: [], openUntil: 0, lastKind: null, trial: false };
      this.entries.set(id, e);
    }
    return e;
  }

  state(id: string): CircuitState {
    const e = this.entry(id);
    if (e.openUntil === 0) return "closed";
    return this.now() >= e.openUntil ? "half_open" : "open";
  }

  /** May a request go to this provider right now? Half-open lets exactly one trial through. */
  allow(id: string): boolean {
    const state = this.state(id);
    if (state === "closed") return true;
    if (state === "open") return false;
    const e = this.entry(id);
    if (e.trial) return false;
    e.trial = true;
    return true;
  }

  success(id: string): void {
    this.entries.set(id, { failures: [], openUntil: 0, lastKind: null, trial: false });
  }

  failure(id: string, kind: ProviderErrorKind): void {
    const e = this.entry(id);
    const now = this.now();
    e.lastKind = kind;
    e.trial = false;
    if (kind === "auth") {
      e.openUntil = now + this.authCooldownMs;
      return;
    }
    if (kind === "quota") {
      e.openUntil = now + this.cooldownMs;
      return;
    }
    e.failures = [...e.failures.filter((t) => now - t < this.windowMs), now];
    if (e.failures.length >= this.failureThreshold || e.openUntil !== 0) e.openUntil = now + this.cooldownMs;
  }

  /** Seconds until the circuit may close, or 0. */
  retryAfterSeconds(id: string): number {
    const e = this.entry(id);
    return Math.max(0, Math.ceil((e.openUntil - this.now()) / 1000));
  }

  snapshot(): Record<string, { state: CircuitState; lastKind: ProviderErrorKind | null }> {
    return Object.fromEntries([...this.entries.keys()].map((id) => [id, { state: this.state(id), lastKind: this.entry(id).lastKind }]));
  }
}

/** One breaker for the whole server process. */
export const providerHealth = new ProviderHealth();
