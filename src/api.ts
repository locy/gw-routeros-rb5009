import { serveDir } from "@std/http/file-server";
import type { DatabaseWrapper, TrafficSample } from "./db.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function createHandler(
  db: DatabaseWrapper,
  wanInterface: string,
  lanInterface: string,
  publicDir: string,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/status") {
      return json({
        interfaces: {
          [wanInterface]: db.getRecentSamples(wanInterface, 1).at(0) ?? null,
          [lanInterface]: db.getRecentSamples(lanInterface, 1).at(0) ?? null,
        },
        topDevices: {
          available: false,
          reason: "Traffic Flow source has not been enabled",
          items: [],
        },
      });
    }
    if (url.pathname.startsWith("/api/history/")) {
      const iface = decodeURIComponent(
        url.pathname.replace("/api/history/", ""),
      );
      return json(db.getRecentSamples(iface, 180));
    }
    if (url.pathname === "/api/events") {
      return json(db.getRecentEvents(20));
    }
    return serveDir(request, { fsRoot: publicDir, urlRoot: "" });
  };
}

// ---- WebSocket broadcast hub ----

// ws package ready state constants
const WS_READY_OPEN = 1;

interface WSClient {
  send(data: string | Uint8Array): void;
  close(): void;
  readyState: number;
}

class BroadcastHub implements WSClient {
  private clients = new Set<WSClient>();

  add(client: WSClient): void {
    this.clients.add(client);
  }

  remove(client: WSClient): void {
    this.clients.delete(client);
  }

  broadcast(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WS_READY_OPEN) {
        try { client.send(msg); } catch { /* closed */ }
      }
    }
  }

  get count(): number {
    return this.clients.size;
  }

  // Serve as a WSClient wrapper itself
  send(data: string | Uint8Array): void {
    for (const client of this.clients) {
      if (client.readyState === WS_READY_OPEN) {
        try { client.send(data); } catch { /* closed */ }
      }
    }
  }

  close(): void {
    for (const client of this.clients) {
      try { client.close(); } catch { /* */ }
    }
    this.clients.clear();
  }

  get readyState(): number {
    return WS_READY_OPEN;
  }
}

export const wsHub = new BroadcastHub();

// Called by collector when new data arrives
export function pushLatestSample(sample: TrafficSample): void {
  wsHub.broadcast({ type: "sample", payload: sample });
}
