import { createServer } from "node:http";
import { createHandler, wsHub } from "./api.ts";
import { Collector } from "./collector.ts";
import { loadSettings } from "./config.ts";
import { DatabaseWrapper } from "./db.ts";
import { MockRouterOSClient, RouterOSClient, parseInterfaceRows } from "./routeros.ts";
import type { loadSettings } from "./config.ts";
import { RouterOSAPI } from "routeros";
import { runRetention } from "./retention.ts";
import { generateReadonlyMonitorScript } from "./routeros_scripts.ts";
import { WebSocketServer } from "ws";

async function createRouterOSClient(settings: Awaited<ReturnType<typeof loadSettings>>): Promise<RouterOSClient> {
  const rosClient = new RouterOSAPI({
    host: settings.routerosHost,
    port: settings.routerosPort,
    user: settings.routerosUser,
    password: settings.routerosPassword,
    timeout: 5,
    keepalive: true,
  });
  await rosClient.connect();
  console.log("[RouterOS] Connected to", settings.routerosHost, "(keepalive enabled)");
  return {
    async readInterfaceCounters() {
      const rows = await rosClient.write("/interface/print", [[".proplist", "name,running,rx-byte,tx-byte,rx-error,tx-error"]]);
      return parseInterfaceRows(rows as import("./routeros").RouterOSRow[], [settings.wanInterface, settings.lanInterface]);
    },
    async readActiveConnections() {
      const rows = await rosClient.write("/ip/firewall/connection/print", [[".proplist", "src-address,dst-address,orig-bytes,repl-bytes,orig-packets,repl-packets,src-port,dst-port,protocol"]]);
      const endpoints: import("./routeros").TopEndpoint[] = [];
      for (const r of rows as import("./routeros").RouterOSRow[]) {
        const srcAddr = String(r["src-address"] ?? "");
        const dstAddr = String(r["dst-address"] ?? "");
        if (!srcAddr || !dstAddr) continue;
        endpoints.push({
          srcIp: srcAddr,
          dstIp: dstAddr,
          srcPort: Number(r["src-port"]) || undefined,
          dstPort: Number(r["dst-port"]) || undefined,
          bytes: (Number(r["orig-bytes"]) || 0) + (Number(r["repl-bytes"]) || 0),
          packets: (Number(r["orig-packets"]) || 0) + (Number(r["repl-packets"]) || 0),
        });
      }
      return endpoints;
    },
    async readDhcpLeases() {
      const rows = await rosClient.write("/ip/dhcp-server/lease/print", [["?dynamic=true"], [".proplist", "active-address,active-mac-address,host-name,active-server,expires-after"]]);
      const leases: import("./routeros").DhcpLease[] = [];
      for (const r of rows as import("./routeros").RouterOSRow[]) {
        leases.push({
          activeAddress: String(r["active-address"] ?? ""),
          activeMac: String(r["active-mac-address"] ?? "") || undefined,
          hostName: String(r["host-name"] ?? "") || undefined,
          activeServer: String(r["active-server"] ?? "") || undefined,
          expiresAfter: String(r["expires-after"] ?? "") || undefined,
          dynamic: true,
        });
      }
      return leases;
    },
  };
}

const command = Deno.args[0] ?? "serve";
const settings = await loadSettings();

if (command === "routeros-script") {
  console.log(generateReadonlyMonitorScript("monitor", "monitor-readonly"));
} else {
  const db = new DatabaseWrapper(settings.databasePath);
  db.migrate();

  // Create ONE shared ROS client (with keepalive) for both collector and API
  let rosClient: RouterOSClient | null = null;
  if (!settings.mockMode) {
    rosClient = await createRouterOSClient(settings);
  }

  if (command === "serve") {
    const handler = createHandler(
      db,
      settings.wanInterface,
      settings.lanInterface,
      "public",
      settings,
      rosClient,
    );
    const server = createServer(async (req, res) => {
      const url = `http://${req.headers.host}${req.url!}`;
      const body = await handler(new Request(url, { method: req.method! }));
      const bodyBuf = Buffer.from(await body.arrayBuffer());
      res.writeHead(body.status, Object.fromEntries(body.headers) as Record<string, string>);
      res.end(bodyBuf);
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      if (url.pathname === "/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      }
    });
    wss.on("connection", (ws, req) => {
      console.log(`[WS] client connected from ${req.socket?.remoteAddress || "unknown"}`);
      wsHub.add(ws);
(globalThis as Record<string, unknown>).__broadcastHub = wsHub;
      ws.on("close", (code, reason) => {
        console.log(`[WS] client disconnected code=${code} reason=${reason.toString()}`);
        wsHub.remove(ws);
      });
      ws.on("error", (e) => {
        console.log(`[WS] client error: ${e.message}`);
        wsHub.remove(ws);
      });
      ws.on("message", (data) => {
        console.log(`[WS] message received: ${data.toString().slice(0, 100)}`);
      });
    });
    server.listen(Number(settings.bindPort), settings.bindHost, () => {
      console.log(`Listening on ${settings.bindHost}:${settings.bindPort}`);
    });

    // Start background collector loop (reuse shared rosClient)
    const client: RouterOSClient = settings.mockMode
      ? new MockRouterOSClient(settings.wanInterface, settings.lanInterface)
      : rosClient!;
    const collector = new Collector(client, db, [settings.wanInterface, settings.lanInterface], settings.spikeThresholdBps);
    console.log("Collector started (polling every", settings.pollIntervalSeconds, "s, spike threshold", settings.spikeThresholdBps, "bps)");
    const poll = async () => {
      try {
        await collector.pollOnce();
      } catch (e) {
        console.error("Collector error:", e);
      }
    };
    // Immediate first poll pair
    poll();
    setTimeout(() => poll(), 2000);
    // Then interval
    setInterval(poll, settings.pollIntervalSeconds * 1000);
  } else if (command === "collector-once") {
    const c: RouterOSClient = settings.mockMode
      ? new MockRouterOSClient(settings.wanInterface, settings.lanInterface)
      : await createRouterOSClient(settings);
    const collector = new Collector(c, db, [settings.wanInterface, settings.lanInterface], settings.spikeThresholdBps);
    // Run 2 polls: first establishes baseline, second computes rate
    await collector.pollOnce();
    await new Promise((r) => setTimeout(r, 2000));
    await collector.pollOnce();
    console.log("collector-once completed (2 samples)");
  } else if (command === "retention") {
    runRetention(db);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}
