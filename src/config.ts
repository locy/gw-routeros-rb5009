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
};

type EnvSource = Record<string, string | undefined>;

function required(env: EnvSource, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
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
  env: EnvSource = Deno.env.toObject(),
): Promise<Settings> {
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
  };
}
