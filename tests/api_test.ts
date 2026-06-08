import { assertEquals } from "@std/assert";
import { createHandler } from "../src/api.ts";
import { DatabaseWrapper } from "../src/db.ts";

Deno.test("status endpoint returns top device waiting state", async () => {
  const db = new DatabaseWrapper(Deno.makeTempFileSync({ suffix: ".sqlite3" }));
  db.migrate();
  const handler = createHandler(db, "ether1", "bridge", "public");

  const response = await handler(new Request("http://local/api/status"));
  const body = await response.json() as unknown;

  assertEquals(response.status, 200);
  assertEquals((body as Record<string, unknown>).topDevices.available, false);
  db.close();
});
