# RouterOS RB5009 Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker Compose service on `gpu` that monitors RouterOS RB5009
WAN/LAN traffic in real time, stores long-term history, and serves an
operations-first dashboard.

**Architecture:** A single Deno/TypeScript service owns RouterOS collection,
SQLite storage, retention, HTTP/SSE APIs, and static dashboard serving. RouterOS
changes are generated as reviewable `.rsc` scripts and are never applied
automatically.

**Tech Stack:** Deno, TypeScript, Deno standard HTTP server, SQLite through
Deno's npm compatibility, native HTML/CSS/TypeScript dashboard, Docker Compose.

---

## File Structure

- Create `deno.json`: tasks, fmt/lint/check/test config, imports.
- Create `.env.example`: safe config template with RouterOS and interface names.
- Create `src/config.ts`: environment parsing and validation.
- Create `src/models.ts`: shared TypeScript types.
- Create `src/traffic.ts`: counter delta and bps calculation.
- Create `src/db.ts`: SQLite connection, migrations, and query helpers.
- Create `src/routeros.ts`: RouterOS client interface, parser, and mock client.
- Create `src/collector.ts`: polling loop, health state, raw writes, event
  generation.
- Create `src/retention.ts`: downsampling and cleanup jobs.
- Create `src/api.ts`: HTTP router, REST endpoints, SSE stream, static file
  serving.
- Create `src/routeros_scripts.ts`: `.rsc` generation for read-only monitoring
  setup.
- Create `src/main.ts`: command entrypoint for server, collector-once,
  retention, script generation.
- Create `public/index.html`: dashboard shell.
- Create `public/app.ts`: browser TypeScript source for dashboard behavior.
- Create `public/styles.css`: restrained operations dashboard styling.
- Create `tests/fixtures/routeros_interfaces.json`: mock RouterOS interface
  data.
- Create `tests/config_test.ts`: settings tests.
- Create `tests/traffic_test.ts`: counter delta tests.
- Create `tests/db_test.ts`: migration and storage tests.
- Create `tests/routeros_test.ts`: RouterOS parser and mock client tests.
- Create `tests/collector_test.ts`: collector loop tests.
- Create `tests/retention_test.ts`: downsampling and cleanup tests.
- Create `tests/api_test.ts`: HTTP endpoint tests.
- Create `tests/routeros_scripts_test.ts`: `.rsc` generator tests.
- Create `Dockerfile`: Deno production image.
- Create `docker-compose.yml`: monitor service and persistent data volume.
- Create `routeros/README.md`: generated script review guidance.
- Create `docs/deploy-gpu.md`: Docker Compose deployment on `gpu`.
- Create `docs/routeros-setup.md`: manual RouterOS setup review and apply flow.
- Create `docs/backup-restore.md`: SQLite backup and restore flow.
- Create `scripts/backup-db.sh`: backup SQLite from Docker volume.

## Task 1: Deno Scaffold And Configuration

**Files:**

- Create: `deno.json`
- Create: `.env.example`
- Create: `src/config.ts`
- Test: `tests/config_test.ts`

- [ ] **Step 1: Write failing config tests**

Create `tests/config_test.ts`:

```ts
import { assertEquals, assertRejects } from "@std/assert";
import { loadSettings } from "../src/config.ts";

Deno.test("loadSettings reads required RouterOS values", async () => {
  const settings = await loadSettings({
    ROUTEROS_HOST: "192.168.88.1",
    ROUTEROS_USER: "monitor",
    ROUTEROS_PASSWORD: "secret",
    WAN_INTERFACE: "ether1",
    LAN_INTERFACE: "bridge",
    DATABASE_PATH: "data/monitor.sqlite3",
  });

  assertEquals(settings.routerosHost, "192.168.88.1");
  assertEquals(settings.routerosPort, 8728);
  assertEquals(settings.pollIntervalSeconds, 5);
  assertEquals(settings.bindHost, "0.0.0.0");
  assertEquals(settings.bindPort, 8080);
});

Deno.test("loadSettings rejects empty interface names", async () => {
  await assertRejects(
    () =>
      loadSettings({
        ROUTEROS_HOST: "192.168.88.1",
        ROUTEROS_USER: "monitor",
        ROUTEROS_PASSWORD: "secret",
        WAN_INTERFACE: "",
        LAN_INTERFACE: "bridge",
      }),
    Error,
    "WAN_INTERFACE",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/config_test.ts"
```

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 3: Add Deno config and settings implementation**

Create `deno.json`:

```json
{
  "tasks": {
    "dev": "deno run --allow-net --allow-read --allow-write --allow-env src/main.ts serve",
    "serve": "deno run --allow-net --allow-read --allow-write --allow-env src/main.ts serve",
    "collector-once": "deno run --allow-net --allow-read --allow-write --allow-env src/main.ts collector-once",
    "retention": "deno run --allow-read --allow-write --allow-env src/main.ts retention",
    "routeros-script": "deno run --allow-read --allow-write src/main.ts routeros-script",
    "test": "deno test --allow-read --allow-write --allow-net --allow-env",
    "check": "deno check src/main.ts public/app.ts",
    "fmt:check": "deno fmt --check"
  },
  "imports": {
    "@std/assert": "jsr:@std/assert@1",
    "@std/http": "jsr:@std/http@1",
    "@std/path": "jsr:@std/path@1",
    "@db/sqlite": "jsr:@db/sqlite@0.12"
  }
}
```

Create `.env.example`:

```dotenv
ROUTEROS_HOST=192.168.88.1
ROUTEROS_USER=monitor
ROUTEROS_PASSWORD=change-me
ROUTEROS_PORT=8728
WAN_INTERFACE=ether1
LAN_INTERFACE=bridge
POLL_INTERVAL_SECONDS=5
DATABASE_PATH=/data/monitor.sqlite3
BIND_HOST=0.0.0.0
BIND_PORT=8080
MOCK_MODE=false
```

Create `src/config.ts`:

```ts
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
```

- [ ] **Step 4: Run config tests**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/config_test.ts"
```

Expected: `2 passed`.

- [ ] **Step 5: Commit scaffold**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; git add deno.json .env.example src/config.ts tests/config_test.ts VERSION; git commit -m 'chore: scaffold deno monitor project'"
```

Expected: commit succeeds and pre-commit increments `VERSION`.

## Task 2: Traffic Types And Rate Calculation

**Files:**

- Create: `src/models.ts`
- Create: `src/traffic.ts`
- Test: `tests/traffic_test.ts`

- [ ] **Step 1: Write failing traffic tests**

Create `tests/traffic_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { calculateRate } from "../src/traffic.ts";
import type { InterfaceCounters } from "../src/models.ts";

Deno.test("calculateRate converts byte deltas into bps", () => {
  const first: InterfaceCounters = {
    interface: "ether1",
    timestamp: new Date("2026-06-07T00:00:00Z"),
    rxBytes: 1000,
    txBytes: 2000,
    linkUp: true,
    rxErrors: 0,
    txErrors: 0,
  };
  const second: InterfaceCounters = {
    ...first,
    timestamp: new Date("2026-06-07T00:00:05Z"),
    rxBytes: 2250,
    txBytes: 3500,
  };

  const sample = calculateRate(first, second);

  assertEquals(sample.rxBps, 2000);
  assertEquals(sample.txBps, 2400);
  assertEquals(sample.valid, true);
  assertEquals(sample.eventType, undefined);
});

Deno.test("calculateRate treats counter reset as invalid sample", () => {
  const first: InterfaceCounters = {
    interface: "ether1",
    timestamp: new Date("2026-06-07T00:00:00Z"),
    rxBytes: 9000,
    txBytes: 9000,
    linkUp: true,
    rxErrors: 0,
    txErrors: 0,
  };
  const second: InterfaceCounters = {
    ...first,
    timestamp: new Date("2026-06-07T00:00:05Z"),
    rxBytes: 100,
    txBytes: 200,
  };

  const sample = calculateRate(first, second);

  assertEquals(sample.rxBps, 0);
  assertEquals(sample.txBps, 0);
  assertEquals(sample.valid, false);
  assertEquals(sample.eventType, "counter_reset");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/traffic_test.ts"
```

Expected: FAIL because `src/traffic.ts` does not exist.

- [ ] **Step 3: Add traffic models and calculation**

Create `src/models.ts`:

```ts
export type InterfaceCounters = {
  interface: string;
  timestamp: Date;
  rxBytes: number;
  txBytes: number;
  linkUp: boolean;
  rxErrors: number;
  txErrors: number;
};

export type TrafficSample = {
  interface: string;
  timestamp: Date;
  rxBps: number;
  txBps: number;
  rxBytes: number;
  txBytes: number;
  linkUp: boolean;
  valid: boolean;
  eventType?: "counter_reset" | "invalid_interval";
};

export type DeviceIdentity = {
  ipAddress: string;
  macAddress: string;
  hostname?: string;
  source: "arp" | "dhcp" | "traffic_flow";
  lastSeen: Date;
};
```

Create `src/traffic.ts`:

```ts
import type { InterfaceCounters, TrafficSample } from "./models.ts";

export function calculateRate(
  previous: InterfaceCounters,
  current: InterfaceCounters,
): TrafficSample {
  const elapsedSeconds =
    (current.timestamp.getTime() - previous.timestamp.getTime()) / 1000;
  const base = {
    interface: current.interface,
    timestamp: current.timestamp,
    rxBytes: current.rxBytes,
    txBytes: current.txBytes,
    linkUp: current.linkUp,
  };

  if (elapsedSeconds <= 0) {
    return {
      ...base,
      rxBps: 0,
      txBps: 0,
      valid: false,
      eventType: "invalid_interval",
    };
  }

  const rxDelta = current.rxBytes - previous.rxBytes;
  const txDelta = current.txBytes - previous.txBytes;
  if (rxDelta < 0 || txDelta < 0) {
    return {
      ...base,
      rxBps: 0,
      txBps: 0,
      valid: false,
      eventType: "counter_reset",
    };
  }

  return {
    ...base,
    rxBps: Math.trunc((rxDelta * 8) / elapsedSeconds),
    txBps: Math.trunc((txDelta * 8) / elapsedSeconds),
    valid: true,
  };
}
```

- [ ] **Step 4: Run traffic tests**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/traffic_test.ts"
```

Expected: `2 passed`.

- [ ] **Step 5: Commit traffic math**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; git add src/models.ts src/traffic.ts tests/traffic_test.ts VERSION; git commit -m 'feat: add deno traffic calculations'"
```

Expected: commit succeeds.

## Task 3: SQLite Storage

**Files:**

- Create: `src/db.ts`
- Test: `tests/db_test.ts`

- [ ] **Step 1: Write failing database tests**

Create `tests/db_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { Database } from "../src/db.ts";
import type { TrafficSample } from "../src/models.ts";

Deno.test("Database migrates and stores samples", () => {
  const path = Deno.makeTempFileSync({ suffix: ".sqlite3" });
  const db = new Database(path);
  db.migrate();

  const sample: TrafficSample = {
    interface: "ether1",
    timestamp: new Date("2026-06-07T00:00:05Z"),
    rxBps: 2000,
    txBps: 2400,
    rxBytes: 2250,
    txBytes: 3500,
    linkUp: true,
    valid: true,
  };
  db.insertSample(sample);

  const rows = db.getRecentSamples("ether1", 10);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].rxBps, 2000);
  assertEquals(rows[0].txBps, 2400);
  db.close();
});

Deno.test("Database records events", () => {
  const path = Deno.makeTempFileSync({ suffix: ".sqlite3" });
  const db = new Database(path);
  db.migrate();
  db.insertEvent("counter_reset", "ether1", "Counter reset detected");

  const events = db.getRecentEvents(5);
  assertEquals(events[0].type, "counter_reset");
  assertEquals(events[0].interface, "ether1");
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/db_test.ts"
```

Expected: FAIL because `src/db.ts` does not exist.

- [ ] **Step 3: Add SQLite database implementation**

Create `src/db.ts`:

```ts
import { DB } from "@db/sqlite";
import { dirname } from "@std/path";
import type { TrafficSample } from "./models.ts";

export type EventRow = {
  timestamp: string;
  type: string;
  interface: string | null;
  message: string;
};

export type RollupRow = {
  bucket: string;
  interface: string;
  timestamp: string;
  avgRxBps: number;
  avgTxBps: number;
  maxRxBps: number;
  maxTxBps: number;
};

export class Database {
  private db: DB;

  constructor(private readonly path: string) {
    const dir = dirname(path);
    if (dir && dir !== ".") {
      Deno.mkdirSync(dir, { recursive: true });
    }
    this.db = new DB(path);
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS traffic_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        interface TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        rx_bps INTEGER NOT NULL,
        tx_bps INTEGER NOT NULL,
        rx_bytes INTEGER NOT NULL,
        tx_bytes INTEGER NOT NULL,
        link_up INTEGER NOT NULL,
        valid INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_samples_interface_time
        ON traffic_samples(interface, timestamp);

      CREATE TABLE IF NOT EXISTS traffic_rollups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bucket TEXT NOT NULL,
        interface TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        avg_rx_bps INTEGER NOT NULL,
        avg_tx_bps INTEGER NOT NULL,
        max_rx_bps INTEGER NOT NULL,
        max_tx_bps INTEGER NOT NULL,
        UNIQUE(bucket, interface, timestamp)
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        interface TEXT,
        message TEXT NOT NULL
      );
    `);
  }

  insertSample(sample: TrafficSample): void {
    this.db.query(
      `INSERT INTO traffic_samples
       (interface, timestamp, rx_bps, tx_bps, rx_bytes, tx_bytes, link_up, valid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sample.interface,
        sample.timestamp.toISOString(),
        sample.rxBps,
        sample.txBps,
        sample.rxBytes,
        sample.txBytes,
        sample.linkUp ? 1 : 0,
        sample.valid ? 1 : 0,
      ],
    );
  }

  getRecentSamples(iface: string, limit: number): TrafficSample[] {
    const rows = [...this.db.queryEntries<Record<string, unknown>>(
      `SELECT * FROM traffic_samples
       WHERE interface = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [iface, limit],
    )].reverse();

    return rows.map((row) => ({
      interface: String(row.interface),
      timestamp: new Date(String(row.timestamp)),
      rxBps: Number(row.rx_bps),
      txBps: Number(row.tx_bps),
      rxBytes: Number(row.rx_bytes),
      txBytes: Number(row.tx_bytes),
      linkUp: Number(row.link_up) === 1,
      valid: Number(row.valid) === 1,
    }));
  }

  insertEvent(type: string, iface: string | null, message: string): void {
    this.db.query(
      "INSERT INTO events (timestamp, type, interface, message) VALUES (?, ?, ?, ?)",
      [new Date().toISOString(), type, iface, message],
    );
  }

  getRecentEvents(limit: number): EventRow[] {
    return [...this.db.queryEntries<EventRow>(
      "SELECT timestamp, type, interface, message FROM events ORDER BY timestamp DESC LIMIT ?",
      [limit],
    )];
  }
}
```

- [ ] **Step 4: Run database tests**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/db_test.ts"
```

Expected: `2 passed`.

- [ ] **Step 5: Commit database layer**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; git add src/db.ts tests/db_test.ts VERSION; git commit -m 'feat: add deno sqlite storage'"
```

Expected: commit succeeds.

## Task 4: RouterOS Boundary And Collector

**Files:**

- Create: `src/routeros.ts`
- Create: `src/collector.ts`
- Create: `tests/fixtures/routeros_interfaces.json`
- Test: `tests/routeros_test.ts`
- Test: `tests/collector_test.ts`

- [ ] **Step 1: Write failing RouterOS and collector tests**

Create `tests/fixtures/routeros_interfaces.json`:

```json
[
  {
    "name": "ether1",
    "running": "true",
    "rx-byte": "2250",
    "tx-byte": "3500",
    "rx-error": "0",
    "tx-error": "0"
  },
  {
    "name": "bridge",
    "running": "true",
    "rx-byte": "8800",
    "tx-byte": "7200",
    "rx-error": "1",
    "tx-error": "0"
  }
]
```

Create `tests/routeros_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { MockRouterOSClient, parseInterfaceRows } from "../src/routeros.ts";

Deno.test("parseInterfaceRows reads selected counters", async () => {
  const rows = JSON.parse(
    await Deno.readTextFile("tests/fixtures/routeros_interfaces.json"),
  );
  const parsed = parseInterfaceRows(rows, ["ether1", "bridge"]);

  assertEquals(parsed.get("ether1")?.rxBytes, 2250);
  assertEquals(parsed.get("bridge")?.rxErrors, 1);
});

Deno.test("MockRouterOSClient returns selected interfaces", async () => {
  const client = new MockRouterOSClient("ether1", "bridge");
  const counters = await client.readInterfaceCounters();

  assertEquals([...counters.keys()].sort(), ["bridge", "ether1"]);
});
```

Create `tests/collector_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { Collector } from "../src/collector.ts";
import { Database } from "../src/db.ts";
import { MockRouterOSClient } from "../src/routeros.ts";

Deno.test("Collector writes samples after two polls", async () => {
  const db = new Database(Deno.makeTempFileSync({ suffix: ".sqlite3" }));
  db.migrate();
  const collector = new Collector(
    new MockRouterOSClient("ether1", "bridge"),
    db,
    ["ether1", "bridge"],
  );

  await collector.pollOnce();
  await collector.pollOnce();

  assertEquals(db.getRecentSamples("ether1", 10).length, 1);
  assertEquals(db.getRecentSamples("bridge", 10).length, 1);
  db.close();
});

Deno.test("Collector records connection failure", async () => {
  const db = new Database(Deno.makeTempFileSync({ suffix: ".sqlite3" }));
  db.migrate();
  const collector = new Collector(
    {
      readInterfaceCounters: () =>
        Promise.reject(new Error("routeros unavailable")),
    },
    db,
    ["ether1"],
  );

  await collector.pollOnce();

  assertEquals(db.getRecentEvents(5)[0].type, "collector_error");
  db.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/routeros_test.ts tests/collector_test.ts"
```

Expected: FAIL because `src/routeros.ts` and `src/collector.ts` do not exist.

- [ ] **Step 3: Add RouterOS parser, mock client, and collector**

Create `src/routeros.ts`:

```ts
import type { InterfaceCounters } from "./models.ts";

export type RouterOSRow = Record<string, unknown>;

export interface RouterOSClient {
  readInterfaceCounters(): Promise<Map<string, InterfaceCounters>>;
}

function routerosBoolean(value: unknown): boolean {
  return ["true", "yes", "1"].includes(String(value).toLowerCase());
}

export function parseInterfaceRows(
  rows: RouterOSRow[],
  interfaceNames: string[],
): Map<string, InterfaceCounters> {
  const selected = new Set(interfaceNames);
  const now = new Date();
  const result = new Map<string, InterfaceCounters>();
  for (const row of rows) {
    const name = String(row.name ?? "");
    if (!selected.has(name)) continue;
    result.set(name, {
      interface: name,
      timestamp: now,
      rxBytes: Number(row["rx-byte"] ?? 0),
      txBytes: Number(row["tx-byte"] ?? 0),
      linkUp: routerosBoolean(row.running),
      rxErrors: Number(row["rx-error"] ?? 0),
      txErrors: Number(row["tx-error"] ?? 0),
    });
  }
  return result;
}

export class MockRouterOSClient implements RouterOSClient {
  private tick = 0;

  constructor(
    private readonly wanInterface: string,
    private readonly lanInterface: string,
  ) {}

  async readInterfaceCounters(): Promise<Map<string, InterfaceCounters>> {
    this.tick += 1;
    const now = new Date();
    return new Map([
      [this.wanInterface, {
        interface: this.wanInterface,
        timestamp: now,
        rxBytes: 1_000_000 + this.tick * 125_000,
        txBytes: 2_000_000 + this.tick * 75_000,
        linkUp: true,
        rxErrors: 0,
        txErrors: 0,
      }],
      [this.lanInterface, {
        interface: this.lanInterface,
        timestamp: now,
        rxBytes: 5_000_000 + this.tick * 180_000,
        txBytes: 4_000_000 + this.tick * 130_000,
        linkUp: true,
        rxErrors: 0,
        txErrors: 0,
      }],
    ]);
  }
}
```

Create `src/collector.ts`:

```ts
import { Database } from "./db.ts";
import type { InterfaceCounters } from "./models.ts";
import type { RouterOSClient } from "./routeros.ts";
import { calculateRate } from "./traffic.ts";

export class Collector {
  private previous = new Map<string, InterfaceCounters>();

  constructor(
    private readonly client: RouterOSClient,
    private readonly db: Database,
    private readonly interfaces: string[],
  ) {}

  async pollOnce(): Promise<void> {
    let counters: Map<string, InterfaceCounters>;
    try {
      counters = await this.client.readInterfaceCounters();
    } catch (error) {
      this.db.insertEvent(
        "collector_error",
        null,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    for (const iface of this.interfaces) {
      const current = counters.get(iface);
      if (!current) {
        this.db.insertEvent(
          "missing_interface",
          iface,
          `${iface} not returned by RouterOS`,
        );
        continue;
      }
      const previous = this.previous.get(iface);
      this.previous.set(iface, current);
      if (!previous) continue;
      const sample = calculateRate(previous, current);
      this.db.insertSample(sample);
      if (sample.eventType) {
        this.db.insertEvent(
          sample.eventType,
          iface,
          `${iface} emitted ${sample.eventType}`,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run RouterOS and collector tests**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/routeros_test.ts tests/collector_test.ts"
```

Expected: `4 passed`.

- [ ] **Step 5: Commit RouterOS and collector**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; git add src/routeros.ts src/collector.ts tests/fixtures/routeros_interfaces.json tests/routeros_test.ts tests/collector_test.ts VERSION; git commit -m 'feat: add deno routeros collector'"
```

Expected: commit succeeds.

## Task 5: Retention And HTTP API

**Files:**

- Create: `src/retention.ts`
- Create: `src/api.ts`
- Modify: `src/db.ts`
- Test: `tests/retention_test.ts`
- Test: `tests/api_test.ts`

- [ ] **Step 1: Write failing retention and API tests**

Create `tests/retention_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { Database } from "../src/db.ts";
import { runRetention } from "../src/retention.ts";
import type { TrafficSample } from "../src/models.ts";

function sampleAt(timestamp: Date, rxBps: number): TrafficSample {
  return {
    interface: "ether1",
    timestamp,
    rxBps,
    txBps: Math.trunc(rxBps / 2),
    rxBytes: rxBps,
    txBytes: Math.trunc(rxBps / 2),
    linkUp: true,
    valid: true,
  };
}

Deno.test("runRetention creates one-minute rollups", () => {
  const db = new Database(Deno.makeTempFileSync({ suffix: ".sqlite3" }));
  db.migrate();
  const base = new Date("2026-06-07T00:00:00Z");
  for (let offset = 0; offset < 60; offset += 5) {
    db.insertSample(
      sampleAt(new Date(base.getTime() + offset * 1000), 1000 + offset),
    );
  }

  runRetention(db, new Date("2026-06-08T00:00:00Z"));

  const rows = db.getRollups("1m", "ether1");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].avgRxBps, 1027);
  assertEquals(rows[0].maxRxBps, 1055);
  db.close();
});
```

Create `tests/api_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { createHandler } from "../src/api.ts";
import { Database } from "../src/db.ts";

Deno.test("status endpoint returns top device waiting state", async () => {
  const db = new Database(Deno.makeTempFileSync({ suffix: ".sqlite3" }));
  db.migrate();
  const handler = createHandler(db, "ether1", "bridge", "public");

  const response = await handler(new Request("http://local/api/status"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.topDevices.available, false);
  db.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/retention_test.ts tests/api_test.ts"
```

Expected: FAIL because `src/retention.ts` and `src/api.ts` do not exist.

- [ ] **Step 3: Extend database helpers**

Add methods to `src/db.ts`:

```ts
  getAllValidSamples(): TrafficSample[] {
    const rows = [...this.db.queryEntries<Record<string, unknown>>(
      "SELECT * FROM traffic_samples WHERE valid = 1 ORDER BY timestamp ASC",
    )];
    return rows.map((row) => ({
      interface: String(row.interface),
      timestamp: new Date(String(row.timestamp)),
      rxBps: Number(row.rx_bps),
      txBps: Number(row.tx_bps),
      rxBytes: Number(row.rx_bytes),
      txBytes: Number(row.tx_bytes),
      linkUp: Number(row.link_up) === 1,
      valid: Number(row.valid) === 1,
    }));
  }

  insertRollup(row: RollupRow): void {
    this.db.query(
      `INSERT OR REPLACE INTO traffic_rollups
       (bucket, interface, timestamp, avg_rx_bps, avg_tx_bps, max_rx_bps, max_tx_bps)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.bucket, row.interface, row.timestamp, row.avgRxBps, row.avgTxBps, row.maxRxBps, row.maxTxBps],
    );
  }

  getRollups(bucket: string, iface: string): RollupRow[] {
    return [...this.db.queryEntries<Record<string, unknown>>(
      `SELECT bucket, interface, timestamp, avg_rx_bps, avg_tx_bps, max_rx_bps, max_tx_bps
       FROM traffic_rollups WHERE bucket = ? AND interface = ? ORDER BY timestamp ASC`,
      [bucket, iface],
    )].map((row) => ({
      bucket: String(row.bucket),
      interface: String(row.interface),
      timestamp: String(row.timestamp),
      avgRxBps: Number(row.avg_rx_bps),
      avgTxBps: Number(row.avg_tx_bps),
      maxRxBps: Number(row.max_rx_bps),
      maxTxBps: Number(row.max_tx_bps),
    }));
  }

  deleteSamplesBefore(cutoff: Date): void {
    this.db.query("DELETE FROM traffic_samples WHERE timestamp < ?", [cutoff.toISOString()]);
  }
```

- [ ] **Step 4: Add retention and API implementation**

Create `src/retention.ts`:

```ts
import { Database } from "./db.ts";
import type { TrafficSample } from "./models.ts";

function minuteBucket(value: Date): string {
  const bucket = new Date(value);
  bucket.setUTCSeconds(0, 0);
  return bucket.toISOString();
}

export function runRetention(db: Database, now = new Date()): void {
  const groups = new Map<string, TrafficSample[]>();
  for (const sample of db.getAllValidSamples()) {
    const key = `${sample.interface}|${minuteBucket(sample.timestamp)}`;
    const list = groups.get(key) ?? [];
    list.push(sample);
    groups.set(key, list);
  }

  for (const [key, samples] of groups) {
    const [iface, timestamp] = key.split("|");
    const rxValues = samples.map((sample) => sample.rxBps);
    const txValues = samples.map((sample) => sample.txBps);
    db.insertRollup({
      bucket: "1m",
      interface: iface,
      timestamp,
      avgRxBps: Math.trunc(
        rxValues.reduce((a, b) => a + b, 0) / rxValues.length,
      ),
      avgTxBps: Math.trunc(
        txValues.reduce((a, b) => a + b, 0) / txValues.length,
      ),
      maxRxBps: Math.max(...rxValues),
      maxTxBps: Math.max(...txValues),
    });
  }

  db.deleteSamplesBefore(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
}
```

Create `src/api.ts`:

```ts
import { serveDir } from "@std/http/file-server";
import { Database } from "./db.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function createHandler(
  db: Database,
  wanInterface: string,
  lanInterface: string,
  publicDir: string,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/status") {
      return json({
        interfaces: {
          [wanInterface]: db.getRecentSamples(wanInterface, 1).at(0) ?? null,
          [lanInterface]: db.getRecentSamples(lanInterface, 1).at(0) ?? null,
        },
        topDevices: {
          available: false,
          reason: "Traffic Flow source has not been enabled",
          items: [],
        },
      });
    }
    if (url.pathname.startsWith("/api/history/")) {
      const iface = decodeURIComponent(
        url.pathname.replace("/api/history/", ""),
      );
      return json(db.getRecentSamples(iface, 180));
    }
    if (url.pathname === "/api/events") {
      return json(db.getRecentEvents(20));
    }
    return serveDir(request, { fsRoot: publicDir, urlRoot: "" });
  };
}
```

- [ ] **Step 5: Run retention and API tests**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/retention_test.ts tests/api_test.ts"
```

Expected: `2 passed`.

- [ ] **Step 6: Commit retention and API**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; git add src/db.ts src/retention.ts src/api.ts tests/retention_test.ts tests/api_test.ts VERSION; git commit -m 'feat: add deno retention and api'"
```

Expected: commit succeeds.

## Task 6: Dashboard Static App And Main Entrypoint

**Files:**

- Create: `public/index.html`
- Create: `public/app.ts`
- Create: `public/styles.css`
- Create: `src/main.ts`

- [ ] **Step 1: Add dashboard files**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>RB5009 Traffic Monitor</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="app-shell">
      <header class="topbar">
        <div>
          <h1>RB5009 Traffic Monitor</h1>
          <p>RouterOS gateway live traffic and history</p>
        </div>
        <nav>
          <button>Live</button>
          <button>History</button>
        </nav>
      </header>
      <section class="dashboard-grid">
        <section class="metric-card">
          <span>WAN 即時</span><strong id="wan-now">等待資料</strong>
        </section>
        <section class="metric-card">
          <span>LAN 即時</span><strong id="lan-now">等待資料</strong>
        </section>
        <section class="metric-card">
          <span>資料延遲</span><strong id="stale-state">尚未連線</strong>
        </section>
        <section class="panel chart-panel">
          <h2>即時流量</h2><canvas
            id="live-chart"
            width="960"
            height="240"
          ></canvas>
        </section>
        <section class="panel">
          <h2>Top IP / MAC</h2>
          <p id="top-devices">Traffic Flow 來源尚未啟用。</p>
        </section>
        <section class="panel">
          <h2>最近事件</h2>
          <ul id="events"></ul>
        </section>
      </section>
    </main>
    <script type="module" src="/app.ts"></script>
  </body>
</html>
```

Create `public/app.ts`:

```ts
type InterfaceStatus = {
  rxBps?: number;
  txBps?: number;
  rx_bps?: number;
  tx_bps?: number;
};

type StatusResponse = {
  interfaces: Record<string, InterfaceStatus | null>;
  topDevices: { available: boolean; reason: string; items: unknown[] };
};

function mbps(value: number): string {
  return `${(value / 1_000_000).toFixed(2)} Mbps`;
}

function rateOf(status: InterfaceStatus | null): string {
  if (!status) return "等待資料";
  const rx = status.rxBps ?? status.rx_bps ?? 0;
  const tx = status.txBps ?? status.tx_bps ?? 0;
  return `↓ ${mbps(rx)} / ↑ ${mbps(tx)}`;
}

async function refresh(): Promise<void> {
  const response = await fetch("/api/status");
  const body = await response.json() as StatusResponse;
  const names = Object.keys(body.interfaces);
  document.querySelector("#wan-now")!.textContent = rateOf(
    body.interfaces[names[0]],
  );
  document.querySelector("#lan-now")!.textContent = rateOf(
    body.interfaces[names[1]],
  );
  document.querySelector("#stale-state")!.textContent = "API 已連線";
  document.querySelector("#top-devices")!.textContent =
    body.topDevices.available ? "已啟用" : body.topDevices.reason;
}

refresh();
setInterval(refresh, 5000);
```

Create `public/styles.css`:

```css
body {
  margin: 0;
  background: #f6f7f9;
  color: #17202a;
  font-family: Inter, "Noto Sans TC", system-ui, sans-serif;
}

button {
  border: 1px solid #c9d1dc;
  background: #fff;
  border-radius: 6px;
  padding: 8px 12px;
}

.app-shell {
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.topbar h1 {
  font-size: 24px;
  margin: 0;
}

.topbar p {
  margin: 4px 0 0;
  color: #5f6b7a;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.metric-card,
.panel {
  background: #fff;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  padding: 16px;
}

.metric-card span {
  display: block;
  color: #5f6b7a;
  margin-bottom: 10px;
}

.metric-card strong {
  font-size: 26px;
}

.chart-panel {
  grid-column: span 3;
}

canvas {
  width: 100%;
  border: 1px dashed #c7d0dd;
  border-radius: 8px;
}
```

- [ ] **Step 2: Add Deno main entrypoint**

Create `src/main.ts`:

```ts
import { serve } from "@std/http/server";
import { createHandler } from "./api.ts";
import { Collector } from "./collector.ts";
import { loadSettings } from "./config.ts";
import { Database } from "./db.ts";
import { MockRouterOSClient } from "./routeros.ts";
import { runRetention } from "./retention.ts";
import { generateReadonlyMonitorScript } from "./routeros_scripts.ts";

const command = Deno.args[0] ?? "serve";
const settings = await loadSettings();
const db = new Database(settings.databasePath);
db.migrate();

if (command === "serve") {
  const handler = createHandler(
    db,
    settings.wanInterface,
    settings.lanInterface,
    "public",
  );
  console.log(`Listening on ${settings.bindHost}:${settings.bindPort}`);
  await serve(handler, {
    hostname: settings.bindHost,
    port: settings.bindPort,
  });
} else if (command === "collector-once") {
  const collector = new Collector(
    new MockRouterOSClient(settings.wanInterface, settings.lanInterface),
    db,
    [settings.wanInterface, settings.lanInterface],
  );
  await collector.pollOnce();
  await collector.pollOnce();
} else if (command === "retention") {
  runRetention(db);
} else if (command === "routeros-script") {
  console.log(generateReadonlyMonitorScript("monitor", "monitor-readonly"));
} else {
  throw new Error(`Unknown command: ${command}`);
}
```

- [ ] **Step 3: Run Deno checks**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno check src/main.ts public/app.ts"
```

Expected: type check succeeds after Task 7 adds `src/routeros_scripts.ts`;
before Task 7, expected failure references that missing module only.

- [ ] **Step 4: Commit dashboard and entrypoint after Task 7 exists**

Run after Task 7 is complete:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; git add public src/main.ts VERSION; git commit -m 'feat: add deno dashboard shell'"
```

Expected: commit succeeds.

## Task 7: RouterOS Script Generator

**Files:**

- Create: `src/routeros_scripts.ts`
- Create: `routeros/README.md`
- Test: `tests/routeros_scripts_test.ts`

- [ ] **Step 1: Write failing script generator test**

Create `tests/routeros_scripts_test.ts`:

```ts
import { assert, assertFalse } from "@std/assert";
import { generateReadonlyMonitorScript } from "../src/routeros_scripts.ts";

Deno.test("generateReadonlyMonitorScript creates group and user without password", () => {
  const script = generateReadonlyMonitorScript("monitor", "monitor-readonly");

  assert(
    script.includes("/user group add name=monitor-readonly policy=read,api"),
  );
  assert(script.includes("/user add name=monitor group=monitor-readonly"));
  assertFalse(script.includes("password="));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/routeros_scripts_test.ts"
```

Expected: FAIL because `src/routeros_scripts.ts` does not exist.

- [ ] **Step 3: Add script generator**

Create `src/routeros_scripts.ts`:

```ts
export function generateReadonlyMonitorScript(
  username: string,
  groupName: string,
): string {
  return [
    "# Review before applying on RouterOS RB5009",
    `/user group add name=${groupName} policy=read,api,!local,!telnet,!ssh,!ftp,!reboot,!write,!policy,!test,!winbox,!password,!web,!sniff,!sensitive,!romon`,
    `/user add name=${username} group=${groupName}`,
    `/user set ${username} disabled=no`,
    "# Set the password manually on the router after reviewing this script.",
  ].join("\n") + "\n";
}
```

Create `routeros/README.md`:

```markdown
# RouterOS 設定腳本

本目錄放置由工具產生、供人工審核的 RouterOS `.rsc` 腳本。

第一版只需要唯讀 API 監控帳號。腳本不包含密碼，請審核後在 RouterOS
上手動設定密碼。
```

- [ ] **Step 4: Run script tests**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test tests/routeros_scripts_test.ts"
```

Expected: `1 passed`.

- [ ] **Step 5: Commit script generator**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; git add src/routeros_scripts.ts routeros/README.md tests/routeros_scripts_test.ts VERSION; git commit -m 'feat: add deno routeros script generator'"
```

Expected: commit succeeds.

## Task 8: Docker, Docs, And Final Verification

**Files:**

- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `docs/deploy-gpu.md`
- Create: `docs/routeros-setup.md`
- Create: `docs/backup-restore.md`
- Create: `scripts/backup-db.sh`

- [ ] **Step 1: Add deployment files**

Create `Dockerfile`:

```dockerfile
FROM denoland/deno:2.4.0
WORKDIR /app
COPY deno.json deno.lock* ./
RUN deno cache src/main.ts || true
COPY src ./src
COPY public ./public
ENV DATABASE_PATH=/data/monitor.sqlite3
EXPOSE 8080
CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "src/main.ts", "serve"]
```

Create `docker-compose.yml`:

```yaml
services:
  monitor:
    build: .
    env_file:
      - .env
    ports:
      - "8080:8080"
    volumes:
      - monitor-data:/data
    restart: unless-stopped

volumes:
  monitor-data:
```

Create `scripts/backup-db.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups
container_id="$(docker compose ps -q monitor)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker cp "${container_id}:/data/monitor.sqlite3" "backups/monitor-${timestamp}.sqlite3"
```

- [ ] **Step 2: Add deployment docs**

Create `docs/deploy-gpu.md`:

```markdown
# gpu 部署

1. 將 repository 放到 `gpu`。
2. 複製 `.env.example` 為 `.env`。
3. 填入 RouterOS host、監控帳號、密碼、WAN/LAN interface 名稱。
4. 執行 `docker compose up -d --build`。
5. 在內網開啟 `http://<gpu-ip>:8080`。
6. 查看 log：`docker compose logs -f monitor`。
```

Create `docs/routeros-setup.md`:

```markdown
# RouterOS 設定

本專案不會自動套用 RouterOS 設定。請先產生 `.rsc`，人工審核後再到 RouterOS
執行。

第一版需要唯讀 API 使用者，密碼請在 RouterOS 上手動設定，不要提交到 git。
```

Create `docs/backup-restore.md`:

````markdown
# 備份與還原

備份：

```bash
scripts/backup-db.sh
```
````

還原：

1. 停止服務：`docker compose down`。
2. 將備份檔複製回 Docker volume 中的 `/data/monitor.sqlite3`。
3. 啟動服務：`docker compose up -d`。

````
- [ ] **Step 3: Run full verification**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno fmt --check"
````

Expected: format check passes.

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno check src/main.ts public/app.ts"
```

Expected: type check passes.

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; deno test --allow-read --allow-write --allow-net --allow-env"
```

Expected: all Deno tests pass.

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; docker compose config"
```

Expected: Docker Compose configuration is valid.

- [ ] **Step 4: Commit deployment assets**

Run:

```powershell
rtk pwsh -Command "Set-Location -LiteralPath 'C:\Users\star\Documents\Codex\2026-06-07\gw-routeros-rb5009'; git add Dockerfile docker-compose.yml docs/deploy-gpu.md docs/routeros-setup.md docs/backup-restore.md scripts/backup-db.sh VERSION; git commit -m 'chore: add deno docker deployment assets'"
```

Expected: commit succeeds.

## Spec Coverage Self-Review

- Architecture: Tasks 1, 3, 4, 5, 6, and 8 create Deno config, storage,
  collector, API, dashboard, and Docker deployment.
- Data flow: Tasks 2, 4, and 5 implement counter parsing, rate calculation,
  polling, writes, REST endpoints, and static dashboard serving.
- Historical retention: Task 5 implements raw cleanup and 1-minute rollups; the
  same module is the extension point for 5-minute, 1-hour, and daily rollups.
- RouterOS reviewable scripts: Task 7 creates the `.rsc` generator and
  documentation.
- Dashboard: Task 6 implements the operations-first shell with WAN/LAN status,
  live chart area, Top IP/MAC waiting state, and events area.
- Deployment and backup: Task 8 creates Docker Compose, `gpu` deployment docs,
  RouterOS setup docs, and backup script.
- Testing: Each implementation task starts with a failing test, then adds
  minimal code, then reruns the targeted test. Final verification runs Deno
  format, type check, tests, and Compose validation.
