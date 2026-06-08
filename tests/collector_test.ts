import { assertEquals } from "@std/assert";
import { Collector } from "../src/collector.ts";
import { DatabaseWrapper } from "../src/db.ts";
import { MockRouterOSClient } from "../src/routeros.ts";

Deno.test("Collector writes samples after two polls", async () => {
  const db = new DatabaseWrapper(Deno.makeTempFileSync({ suffix: ".sqlite3" }));
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
  const db = new DatabaseWrapper(Deno.makeTempFileSync({ suffix: ".sqlite3" }));
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
