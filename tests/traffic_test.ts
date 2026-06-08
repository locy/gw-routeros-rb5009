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

Deno.test("calculateRate rejects invalid interval (same timestamp)", () => {
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
  };

  const sample = calculateRate(first, second);

  assertEquals(sample.valid, false);
  assertEquals(sample.eventType, "invalid_interval");
});
