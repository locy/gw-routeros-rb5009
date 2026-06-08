import { assertEquals } from "@std/assert";
import { DatabaseWrapper } from "../src/db.ts";
import { runRetention } from "../src/retention.ts";
import type { TrafficSample } from "../src/models.ts";

function sampleAt(
  timestamp: Date,
  rxBps: number,
  iface = "ether1",
): TrafficSample {
  return {
    interface: iface,
    timestamp,
    rxBps,
    txBps: Math.trunc(rxBps / 2),
    rxBytes: rxBps,
    txBytes: Math.trunc(rxBps / 2),
    linkUp: true,
    valid: true,
  };
}

Deno.test("runRetention creates one-minute rollups", async () => {
  const db = new DatabaseWrapper(Deno.makeTempFileSync({ suffix: ".sqlite3" }));
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
