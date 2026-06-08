import { serveDir } from "@std/http/file-server";
import type { DatabaseWrapper } from "./db.ts";

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
