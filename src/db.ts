import { Database } from "@db/sqlite";
import { dirname } from "@std/path";
import type { TrafficSample } from "./models.ts";

export type EventRow = {
  timestamp: string;
  type: string;
  interface: string | null;
  message: string;
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

function queryAll(
  db: Database,
  sql: string,
  params?: unknown[],
): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  const bind: Array<number | string | boolean | null | undefined> = params ??
    [];
  for (const row of stmt.iter(...bind)) {
    rows.push(row);
  }
  return rows;
}

export class DatabaseWrapper {
  private db: Database;

  constructor(private readonly path: string) {
    const dir = dirname(path);
    if (dir && dir !== ".") {
      Deno.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(path);
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.run(`
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
    this.db.run(
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
    const rows = queryAll(
      this.db,
      `SELECT * FROM traffic_samples
       WHERE interface = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [iface, limit],
    );

    return rows.reverse().map((row) => ({
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

  getSamplesByDateRange(iface: string, since: Date): TrafficSample[] {
    const rows = queryAll(
      this.db,
      `SELECT * FROM traffic_samples
       WHERE interface = ? AND timestamp >= ? AND valid = 1
       ORDER BY timestamp ASC`,
      [iface, since.toISOString()],
    );

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
    this.db.run(
      "INSERT INTO events (timestamp, type, interface, message) VALUES (?, ?, ?, ?)",
      [new Date().toISOString(), type, iface, message],
    );
  }

  getRecentEvents(limit: number): EventRow[] {
    return queryAll(
      this.db,
      "SELECT timestamp, type, interface, message FROM events ORDER BY timestamp DESC LIMIT ?",
      [limit],
    ).map((row) => ({
      timestamp: String(row.timestamp),
      type: String(row.type),
      interface: row.interface as string | null,
      message: String(row.message),
    }));
  }

  getAllValidSamples(): TrafficSample[] {
    const rows = queryAll(
      this.db,
      "SELECT * FROM traffic_samples WHERE valid = 1 ORDER BY timestamp ASC",
    );
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
    this.db.run(
      `INSERT OR REPLACE INTO traffic_rollups
       (bucket, interface, timestamp, avg_rx_bps, avg_tx_bps, max_rx_bps, max_tx_bps)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.bucket,
        row.interface,
        row.timestamp,
        row.avgRxBps,
        row.avgTxBps,
        row.maxRxBps,
        row.maxTxBps,
      ],
    );
  }

  getRollups(bucket: string, iface: string): RollupRow[] {
    return queryAll(
      this.db,
      `SELECT bucket, interface, timestamp, avg_rx_bps, avg_tx_bps, max_rx_bps, max_tx_bps
       FROM traffic_rollups WHERE bucket = ? AND interface = ? ORDER BY timestamp ASC`,
      [bucket, iface],
    ).map((row) => ({
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
    this.db.run("DELETE FROM traffic_samples WHERE timestamp < ?", [
      cutoff.toISOString(),
    ]);
  }
}
