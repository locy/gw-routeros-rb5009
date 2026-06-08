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
