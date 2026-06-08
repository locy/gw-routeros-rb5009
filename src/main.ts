import { createServer } from "node:http";
import { createHandler, wsHub } from "./api.ts";
import { Collector } from "./collector.ts";
import { loadSettings } from "./config.ts";
import { DatabaseWrapper } from "./db.ts";
import { MockRouterOSClient } from "./routeros.ts";
import { runRetention } from "./retention.ts";
import { generateReadonlyMonitorScript } from "./routeros_scripts.ts";
import { WebSocketServer } from "ws";

const command = Deno.args[0] ?? "serve";
const settings = await loadSettings();

if (command === "routeros-script") {
  console.log(generateReadonlyMonitorScript("monitor", "monitor-readonly"));
} else {
  const db = new DatabaseWrapper(settings.databasePath);
  db.migrate();

  if (command === "serve") {
    const handler = createHandler(
      db,
      settings.wanInterface,
      settings.lanInterface,
      "public",
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
      ws.on("close", () => {
        console.log(`[WS] client disconnected`);
        wsHub.remove(ws);
      });
      ws.on("error", (e) => {
        console.log(`[WS] client error`);
        wsHub.remove(ws);
      });
    });
    server.listen(Number(settings.bindPort), settings.bindHost, () => {
      console.log(`Listening on ${settings.bindHost}:${settings.bindPort}`);
    });

    // Start background collector loop
    const collector = new Collector(
      new MockRouterOSClient(settings.wanInterface, settings.lanInterface),
      db,
      [settings.wanInterface, settings.lanInterface],
    );
    console.log("Collector started (polling every", settings.pollIntervalSeconds, "s)");
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
    const collector = new Collector(
      new MockRouterOSClient(settings.wanInterface, settings.lanInterface),
      db,
      [settings.wanInterface, settings.lanInterface],
    );
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
