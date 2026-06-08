import { serveDir } from "@std/http/file-server";
import type { DatabaseWrapper, TrafficSample } from "./db.ts";
import type { RouterOSClient } from "./routeros.ts";
import type { Settings } from "./config.ts";

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
  settings: Settings | null = null,
  rosClient: RouterOSClient | null = null,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/status") {
      // Build IP-to-MAC mapping from DHCP leases + get active connections via shared client
      const ipToMacMap = new Map<string, { mac?: string; hostname?: string }>();
      const topByIp = new Map<string, { bytes: number; packets: number; mac?: string; hostname?: string }>();
      if (rosClient) {
        try {
          const leases = await rosClient.readDhcpLeases();
          for (const l of leases) {
            ipToMacMap.set(l.activeAddress, {
              mac: l.activeMac,
              hostname: l.hostName,
            });
          }

          const conns = await rosClient.readActiveConnections();
          for (const c of conns) {
            const isLocalSrc = /^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\./.test(c.srcIp);
            const isExternalDst = !/^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\./.test(c.dstIp ?? "");
            if (isLocalSrc && isExternalDst) {
              const entry = topByIp.get(c.srcIp);
              if (entry) {
                entry.bytes += c.bytes;
                entry.packets += c.packets;
              } else {
                const ipInfo = ipToMacMap.get(c.srcIp);
                topByIp.set(c.srcIp, {
                  bytes: c.bytes,
                  packets: c.packets,
                  mac: ipInfo?.mac,
                  hostname: ipInfo?.hostname,
                });
              }
            }
          }
        } catch {
          // ignore ROS errors
        }
      }

      // Sort by bytes and return top 20
      const items = Array.from(topByIp.entries())
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .slice(0, 20)
        .map(([ip, d]) => ({
          ip,
          bytes: d.bytes,
          packets: d.packets,
          mac: d.mac ?? "-",
          hostname: d.hostname ?? "-",
        }));

      return json({
        interfaces: {
          [wanInterface]: db.getRecentSamples(wanInterface, 1).at(0) ?? null,
          [lanInterface]: db.getRecentSamples(lanInterface, 1).at(0) ?? null,
        },
        topDevices: {
          available: items.length > 0,
          items,
        },
      });
    }
    if (url.pathname.startsWith("/api/history/")) {
      const iface = decodeURIComponent(
        url.pathname.replace("/api/history/", ""),
      );
      const range = url.searchParams.get("range");
      if (range) {
        const seconds = parseInt(range, 10);
        if (seconds > 0) {
          const cutoff = new Date(Date.now() - seconds * 1000);
          return json(db.getSamplesByDateRange(iface, cutoff));
        }
      }
      return json(db.getRecentSamples(iface, 180));
    }
    if (url.pathname === "/api/events") {
      return json(db.getRecentEvents(20));
    }
    if (url.pathname === "/api/debug/state") {
      // Return latest browser snapshot (served via fetch from browser)
      const cached = (globalThis as Record<string, unknown>).__debugState;
      if (cached && typeof cached === "object") {
        return json(cached);
      }
      return json({ error: "no snapshot yet", timestamp: new Date().toISOString() });
    }
    if (url.pathname === "/api/debug/check") {
      // Comprehensive server-side diagnostic
      const recentWan = db.getRecentSamples(wanInterface, 10);
      const recentLan = db.getRecentSamples(lanInterface, 10);
      const events = db.getRecentEvents(10);
      const statusSnap = await json(new Response("")).json(); // trigger status endpoint
      // Re-run status logic
      const ipToMacMap = new Map<string, { mac?: string; hostname?: string }>();
      const topByIp = new Map<string, { bytes: number; packets: number; mac?: string; hostname?: string }>();
      if (rosClient) {
        try {
          const leases = await rosClient.readDhcpLeases();
          for (const l of leases) {
            ipToMacMap.set(l.activeAddress, { mac: l.activeMac, hostname: l.hostName });
          }
          const conns = await rosClient.readActiveConnections();
          for (const c of conns) {
            const isLocalSrc = /^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\./.test(c.srcIp);
            const isExternalDst = !/^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\./.test(c.dstIp ?? "");
            if (isLocalSrc && isExternalDst) {
              const entry = topByIp.get(c.srcIp);
              if (entry) {
                entry.bytes += c.bytes; entry.packets += c.packets;
              } else {
                const ipInfo = ipToMacMap.get(c.srcIp);
                topByIp.set(c.srcIp, { bytes: c.bytes, packets: c.packets, mac: ipInfo?.mac, hostname: ipInfo?.hostname });
              }
            }
          }
        } catch { /* ignore */ }
      }
      const items = Array.from(topByIp.entries())
        .sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 20)
        .map(([ip, d]) => ({ ip, bytes: d.bytes, packets: d.packets, mac: d.mac ?? "-", hostname: d.hostname ?? "-" }));
      return json({
        timestamp: new Date().toISOString(),
        server: {
          wanRecentSamples: recentWan.length,
          lanRecentSamples: recentLan.length,
          wanLatest: recentWan[0] ? { rxBytes: recentWan[0].rxBytes, txBytes: recentWan[0].txBytes, timestamp: recentWan[0].timestamp } : null,
          lanLatest: recentLan[0] ? { rxBytes: recentLan[0].rxBytes, txBytes: recentLan[0].txBytes, timestamp: recentLan[0].timestamp } : null,
          eventsCount: events.length,
          topDevices: items.length,
          wsClients: wsHub.count,
        },
        browserSnapshot: (globalThis as Record<string, unknown>).__debugState || null,
      });
    }
    if (url.pathname === "/api/debug/history") {
      const cached = (globalThis as Record<string, unknown>).__debugHistory;
      if (cached && Array.isArray(cached)) {
        return json(cached.slice(-20));
      }
      return json([]);
    }
    if (url.pathname === "/api/debug/snapshot") {
      if (request.method === "POST") {
        const bodyText = await request.text();
        if (!bodyText) return json({ ok: false, error: "empty body" });
        const snap = JSON.parse(bodyText);
        (globalThis as Record<string, unknown>).__debugState = snap;
        let hist = (globalThis as Record<string, unknown>).__debugHistory as Record<string, unknown>[] | undefined;
        if (!hist) { hist = []; (globalThis as Record<string, unknown>).__debugHistory = hist; }
        hist.push(snap as Record<string, unknown>);
        if (hist.length > 100) hist.shift();
        (globalThis as Record<string, unknown>).__debugHistory = hist;
        return json({ ok: true, total: hist.length });
      }
      // GET: return latest stored snapshot
      const cached = (globalThis as Record<string, unknown>).__debugState;
      if (cached && typeof cached === "object") return json(cached);
      return json({ error: "no snapshot yet", timestamp: new Date().toISOString() });
    }
    if (url.pathname === "/api/debug/reset") {
      delete (globalThis as Record<string, unknown>).__debugState;
      delete (globalThis as Record<string, unknown>).__debugHistory;
      return json({ ok: true });
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
