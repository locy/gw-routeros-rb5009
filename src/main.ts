import { serve } from "@std/http/server";
import { createHandler } from "./api.ts";
import { Collector } from "./collector.ts";
import { loadSettings } from "./config.ts";
import { DatabaseWrapper } from "./db.ts";
import { MockRouterOSClient } from "./routeros.ts";
import { runRetention } from "./retention.ts";
import { generateReadonlyMonitorScript } from "./routeros_scripts.ts";

const command = Deno.args[0] ?? "serve";
const settings = await loadSettings();
const db = new DatabaseWrapper(settings.databasePath);
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
