export const BEHAVIOR_BOUNDS = {
  cooldownSeconds: { maximum: 86_400, minimum: 0 },
  threshold: { maximum: 100, minimum: 3 },
  windowSeconds: { maximum: 3_600, minimum: 30 },
} as const;

export interface GuildBehaviorConfig {
  cooldownSeconds: number;
  pingTarget: boolean;
  threshold: number;
  windowSeconds: number;
}

export const DEFAULT_BEHAVIOR_CONFIG: Readonly<GuildBehaviorConfig> = {
  cooldownSeconds: 600,
  pingTarget: true,
  threshold: 15,
  windowSeconds: 300,
};

function isIntegerWithin(
  value: number,
  minimum: number,
  maximum: number,
): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function validateBehaviorConfig(
  config: GuildBehaviorConfig,
): readonly string[] {
  const errors: string[] = [];

  if (
    !isIntegerWithin(
      config.threshold,
      BEHAVIOR_BOUNDS.threshold.minimum,
      BEHAVIOR_BOUNDS.threshold.maximum,
    )
  ) {
    errors.push("threshold is outside the supported range");
  }

  if (
    !isIntegerWithin(
      config.windowSeconds,
      BEHAVIOR_BOUNDS.windowSeconds.minimum,
      BEHAVIOR_BOUNDS.windowSeconds.maximum,
    )
  ) {
    errors.push("windowSeconds is outside the supported range");
  }

  if (
    !isIntegerWithin(
      config.cooldownSeconds,
      BEHAVIOR_BOUNDS.cooldownSeconds.minimum,
      BEHAVIOR_BOUNDS.cooldownSeconds.maximum,
    )
  ) {
    errors.push("cooldownSeconds is outside the supported range");
  }

  return errors;
}

export interface DetectorInput {
  cooldownSeconds: number;
  guildId: string;
  nowMs: number;
  threshold: number;
  userId: string;
  windowSeconds: number;
}

export interface DetectorDecision {
  count: number;
  outcome: "below_threshold" | "cooldown" | "trigger";
}

interface MemberState {
  cooldownUntilMs: number;
  lastActivityMs: number;
  timestamps: number[];
}

export class RollingTriggerDetector {
  readonly #states = new Map<string, MemberState>();

  evaluate(input: DetectorInput): DetectorDecision {
    const key = memberKey(input.guildId, input.userId);
    const state = this.#states.get(key) ?? {
      cooldownUntilMs: 0,
      lastActivityMs: input.nowMs,
      timestamps: [],
    };
    const windowStartMs = input.nowMs - input.windowSeconds * 1_000;

    state.timestamps = state.timestamps.filter(
      (timestamp) => timestamp >= windowStartMs,
    );
    state.timestamps.push(input.nowMs);
    state.lastActivityMs = input.nowMs;
    this.#states.set(key, state);

    if (state.timestamps.length < input.threshold) {
      return { count: state.timestamps.length, outcome: "below_threshold" };
    }

    if (input.nowMs < state.cooldownUntilMs) {
      return { count: state.timestamps.length, outcome: "cooldown" };
    }

    state.cooldownUntilMs = input.nowMs + input.cooldownSeconds * 1_000;
    return { count: state.timestamps.length, outcome: "trigger" };
  }

  clearGuild(guildId: string): void {
    const prefix = `${guildId}:`;

    for (const key of this.#states.keys()) {
      if (key.startsWith(prefix)) {
        this.#states.delete(key);
      }
    }
  }

  sweep(nowMs: number, maximumIdleSeconds: number): number {
    const oldestAllowedMs = nowMs - maximumIdleSeconds * 1_000;
    let removed = 0;

    for (const [key, state] of this.#states.entries()) {
      if (
        state.lastActivityMs < oldestAllowedMs &&
        state.cooldownUntilMs <= nowMs
      ) {
        this.#states.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  get size(): number {
    return this.#states.size;
  }
}

export class KeyedMutex {
  readonly #tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tails.set(key, current);

    await previous;

    try {
      return await task();
    } finally {
      release?.();
      if (this.#tails.get(key) === current) {
        this.#tails.delete(key);
      }
    }
  }
}

function memberKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}
