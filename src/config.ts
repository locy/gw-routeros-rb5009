import { load } from "jsr:@std/dotenv";

export type Settings = {
  routerosHost: string;
  routerosUser: string;
  routerosPassword: string;
  routerosPort: number;
  wanInterface: string;
  lanInterface: string;
  pollIntervalSeconds: number;
  databasePath: string;
  bindHost: string;
  bindPort: number;
  mockMode: boolean;
  spikeThresholdBps: number;
};

type EnvSource = Record<string, string | undefined>;

function required(env: EnvSource, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function parseBandwidth(env: EnvSource, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  // Support "100M", "1G", "1.5G", "500K" etc.
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|KB|K|M|G|TB|T)$/i) || raw.match(/^(\d+(?:\.\d+)?)$/);
  if (!match) throw new Error(`${key} invalid format: "${raw}". Use e.g. "100M", "1G"`);
  const value = parseFloat(match[1]);
  const unitKey = match[2]?.toUpperCase() || "";
  const multipliers: Record<string, number> = {
    K: 1_000, KB: 1_000,
    M: 1_000_000, MB: 1_000_000,
    G: 1_000_000_000,
    T: 1_000_000_000_000, TB: 1_000_000_000_000,
  };
  const multiplier = multipliers[unitKey] ?? 1;
  return Math.trunc(value * multiplier);
}

function integer(env: EnvSource, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${key} must be an integer`);
  }
  return parsed;
}

export async function loadSettings(
  env: EnvSource | undefined = undefined,
): Promise<Settings> {
  if (env === undefined) {
    // Try to load from .env file first, then fall back to process env
    const dotEnv = await load({ parse: true, env: [] }).catch(
      () => ({}),
    );
    env = { ...Deno.env.toObject(), ...dotEnv };
  }
  return {
    routerosHost: required(env, "ROUTEROS_HOST"),
    routerosUser: required(env, "ROUTEROS_USER"),
    routerosPassword: required(env, "ROUTEROS_PASSWORD"),
    routerosPort: integer(env, "ROUTEROS_PORT", 8728),
    wanInterface: required(env, "WAN_INTERFACE"),
    lanInterface: required(env, "LAN_INTERFACE"),
    pollIntervalSeconds: integer(env, "POLL_INTERVAL_SECONDS", 5),
    databasePath: env.DATABASE_PATH?.trim() || "data/monitor.sqlite3",
    bindHost: env.BIND_HOST?.trim() || "0.0.0.0",
    bindPort: integer(env, "BIND_PORT", 8080),
    mockMode: (env.MOCK_MODE ?? "false").toLowerCase() === "true",
    spikeThresholdBps: parseBandwidth(env, "SPIKE_THRESHOLD_BPS", 1_000_000_000),
  };
}
