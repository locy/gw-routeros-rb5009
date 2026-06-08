import { assertEquals } from "@std/assert";
import { DatabaseWrapper } from "../src/db.ts";
import type { TrafficSample } from "../src/models.ts";

Deno.test("Database migrates and stores samples", () => {
  const path = Deno.makeTempFileSync({ suffix: ".sqlite3" });
  const db = new DatabaseWrapper(path);
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
  const db = new DatabaseWrapper(path);
  db.migrate();
  db.insertEvent("counter_reset", "ether1", "Counter reset detected");

  const events = db.getRecentEvents(5);
  assertEquals(events[0].type, "counter_reset");
  assertEquals(events[0].interface, "ether1");
  db.close();
});
