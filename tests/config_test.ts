import { assertEquals, assertRejects } from "@std/assert";
import { loadSettings } from "../src/config.ts";

Deno.test("loadSettings reads required RouterOS values", async () => {
  const settings = await loadSettings({
    ROUTEROS_HOST: "192.168.88.1",
    ROUTEROS_USER: "monitor",
    ROUTEROS_PASSWORD: "secret",
    WAN_INTERFACE: "ether1",
    LAN_INTERFACE: "bridge",
    DATABASE_PATH: "data/monitor.sqlite3",
  });

  assertEquals(settings.routerosHost, "192.168.88.1");
  assertEquals(settings.routerosPort, 8728);
  assertEquals(settings.pollIntervalSeconds, 5);
  assertEquals(settings.bindHost, "0.0.0.0");
  assertEquals(settings.bindPort, 8080);
});

Deno.test("loadSettings rejects empty interface names", async () => {
  await assertRejects(
    () =>
      loadSettings({
        ROUTEROS_HOST: "192.168.88.1",
        ROUTEROS_USER: "monitor",
        ROUTEROS_PASSWORD: "secret",
        WAN_INTERFACE: "",
        LAN_INTERFACE: "bridge",
      }),
    Error,
    "WAN_INTERFACE",
  );
});

Deno.test("loadSettings uses port fallback", async () => {
  const settings = await loadSettings({
    ROUTEROS_HOST: "192.168.88.1",
    ROUTEROS_USER: "monitor",
    ROUTEROS_PASSWORD: "secret",
    WAN_INTERFACE: "ether1",
    LAN_INTERFACE: "bridge",
  });

  assertEquals(settings.routerosPort, 8728);
});

Deno.test("loadSettings enables mockMode when true", async () => {
  const settings = await loadSettings({
    ROUTEROS_HOST: "192.168.88.1",
    ROUTEROS_USER: "monitor",
    ROUTEROS_PASSWORD: "secret",
    WAN_INTERFACE: "ether1",
    LAN_INTERFACE: "bridge",
    MOCK_MODE: "true",
  });

  assertEquals(settings.mockMode, true);
});

Deno.test("loadSettings rejects non-integer port", async () => {
  await assertRejects(
    () =>
      loadSettings({
        ROUTEROS_HOST: "192.168.88.1",
        ROUTEROS_USER: "monitor",
        ROUTEROS_PASSWORD: "secret",
        WAN_INTERFACE: "ether1",
        LAN_INTERFACE: "bridge",
        ROUTEROS_PORT: "abc",
      }),
    Error,
    "ROUTEROS_PORT",
  );
});
