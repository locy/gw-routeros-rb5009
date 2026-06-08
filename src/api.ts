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
