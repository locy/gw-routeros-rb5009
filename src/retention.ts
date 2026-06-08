import type { DatabaseWrapper } from "./db.ts";
import type { TrafficSample } from "./models.ts";

function minuteBucket(value: Date): string {
  const bucket = new Date(value);
  bucket.setUTCSeconds(0, 0);
  return bucket.toISOString();
}

export function runRetention(db: DatabaseWrapper, now = new Date()): void {
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
