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
