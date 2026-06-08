import type { InterfaceCounters } from "./models.ts";

export type RouterOSRow = Record<string, unknown>;

export interface TopEndpoint {
  srcIp: string;
  dstIp?: string;
  srcPort?: number;
  dstPort?: number;
  bytes: number;
  packets: number;
}

export interface DhcpLease {
  activeAddress: string;
  activeMac?: string;
  hostName?: string;
  activeServer?: string;
  expiresAfter?: string;
  dynamic: boolean;
  blocked?: boolean;
}

export interface RouterOSClient {
  readInterfaceCounters(): Promise<Map<string, InterfaceCounters>>;
  readActiveConnections(): Promise<TopEndpoint[]>;
  readDhcpLeases(): Promise<DhcpLease[]>;
}

function routerosBoolean(value: unknown): boolean {
  return ["true", "yes", "1"].includes(String(value).toLowerCase());
}

export function parseInterfaceRows(
  rows: RouterOSRow[],
  interfaceNames: string[],
): Map<string, InterfaceCounters> {
  const selected = new Set(interfaceNames);
  const now = new Date();
  const result = new Map<string, InterfaceCounters>();
  for (const row of rows) {
    const name = String(row.name ?? "");
    if (!selected.has(name)) continue;
    result.set(name, {
      interface: name,
      timestamp: now,
      rxBytes: Number(row["rx-byte"] ?? 0),
      txBytes: Number(row["tx-byte"] ?? 0),
      linkUp: routerosBoolean(row.running),
      rxErrors: Number(row["rx-error"] ?? 0),
      txErrors: Number(row["tx-error"] ?? 0),
    });
  }
  return result;
}

export class MockRouterOSClient implements RouterOSClient {
  private tick = 0;

  constructor(
    private readonly wanInterface: string,
    private readonly lanInterface: string,
  ) {}

  async readInterfaceCounters(): Promise<Map<string, InterfaceCounters>> {
    this.tick += 1;
    const now = new Date();
    return new Map([
      [this.wanInterface, {
        interface: this.wanInterface,
        timestamp: now,
        rxBytes: 1_000_000 + this.tick * 125_000,
        txBytes: 2_000_000 + this.tick * 75_000,
        linkUp: true,
        rxErrors: 0,
        txErrors: 0,
      }],
      [this.lanInterface, {
        interface: this.lanInterface,
        timestamp: now,
        rxBytes: 5_000_000 + this.tick * 180_000,
        txBytes: 4_000_000 + this.tick * 130_000,
        linkUp: true,
        rxErrors: 0,
        txErrors: 0,
      }],
    ]);
  }

  async readActiveConnections(): Promise<TopEndpoint[]> {
    return [
      { srcIp: "192.168.7.100", dstIp: "8.8.8.8", bytes: 1234567, packets: 100 },
      { srcIp: "192.168.7.200", dstIp: "1.1.1.1", bytes: 987654, packets: 50 },
    ];
  }

  async readDhcpLeases(): Promise<DhcpLease[]> {
    return [{
      activeAddress: "192.168.7.100",
      activeMac: "AA:BB:CC:DD:EE:FF",
      hostName: "test-pc",
      dynamic: true,
      expiresAfter: "1h",
    }];
  }
}
