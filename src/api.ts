import { serveDir } from "@std/http/file-server";
import { RouterOSAPI } from "routeros";
import type { DatabaseWrapper, TrafficSample } from "./db.ts";
import type { RouterOSClient, DhcpLease, TopEndpoint } from "./routeros.ts";
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
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/status") {
      // Build IP-to-MAC mapping from DHCP leases (use separate ROS client to avoid channel conflicts)
      const ipToMacMap = new Map<string, { mac?: string; hostname?: string }>();
      if (settings && !settings.mockMode) {
        try {
          const ros = new RouterOSAPI({
            host: settings.routerosHost,
            port: settings.routerosPort,
            user: settings.routerosUser,
            password: settings.routerosPassword,
            
          });
          await ros.connect();
          const rows = await ros.write("/ip/dhcp-server/lease/print", ["?dynamic=true"], [".proplist", "active-address,active-mac-address,host-name,active-server,expires-after"]);
          for (const r of rows as import("./routeros.ts").RouterOSRow[]) {
            ipToMacMap.set(String(r["active-address"] ?? ""), {
              mac: String(r["active-mac-address"] ?? "") || undefined,
              hostname: String(r["host-name"] ?? "") || undefined,
            });
          }
          ros.close();
        } catch {
          // ignore DHCP errors
        }
      }

      // Get active connections and aggregate by top source IP
      const topByIp = new Map<string, { bytes: number; packets: number; mac?: string; hostname?: string }>();
      if (settings && !settings.mockMode) {
        try {
          const ros2 = new RouterOSAPI({
            host: settings.routerosHost,
            port: settings.routerosPort,
            user: settings.routerosUser,
            password: settings.routerosPassword,
            
          });
          await ros2.connect();
          const rows = await ros2.write("/ip/firewall/connection/print", [".proplist", "src-address,dst-address,orig-bytes,repl-bytes,orig-packets,repl-packets,src-port,dst-port,protocol"]);
          for (const r of rows as import("./routeros.ts").RouterOSRow[]) {
            const srcAddr = String(r["src-address"] ?? "");
            const dstAddr = String(r["dst-address"] ?? "");
            if (!srcAddr || !dstAddr) continue;
            const isLocalSrc = /^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\./.test(srcAddr);
            const isExternalDst = !/^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\./.test(dstAddr);
            if (isLocalSrc && isExternalDst) {
              const entry = topByIp.get(srcAddr);
              const bytes = (Number(r["orig-bytes"]) || 0) + (Number(r["repl-bytes"]) || 0);
              const packets = (Number(r["orig-packets"]) || 0) + (Number(r["repl-packets"]) || 0);
              if (entry) {
                entry.bytes += bytes;
                entry.packets += packets;
              } else {
                const ipInfo = ipToMacMap.get(srcAddr);
                topByIp.set(srcAddr, {
                  bytes,
                  packets,
                  mac: ipInfo?.mac,
                  hostname: ipInfo?.hostname,
                });
              }
            }
          }
          ros2.close();
        } catch {
          // ignore connection errors
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
