type InterfaceStatus = {
  rxBps?: number;
  txBps?: number;
  rx_bps?: number;
  tx_bps?: number;
};

type StatusResponse = {
  interfaces: Record<string, InterfaceStatus | null>;
  topDevices: { available: boolean; reason: string; items: unknown[] };
};

function mbps(value: number): string {
  return `${(value / 1_000_000).toFixed(2)} Mbps`;
}

function rateOf(status: InterfaceStatus | null): string {
  if (!status) return "等待資料";
  const rx = status.rxBps ?? status.rx_bps ?? 0;
  const tx = status.txBps ?? status.tx_bps ?? 0;
  return `↓ ${mbps(rx)} / ↑ ${mbps(tx)}`;
}

async function refresh(): Promise<void> {
  const response = await fetch("/api/status");
  const body = await response.json() as StatusResponse;
  const names = Object.keys(body.interfaces);
  document.querySelector("#wan-now")!.textContent = rateOf(
    body.interfaces[names[0]],
  );
  document.querySelector("#lan-now")!.textContent = rateOf(
    body.interfaces[names[1]],
  );
  document.querySelector("#stale-state")!.textContent = "API 已連線";
  document.querySelector("#top-devices")!.textContent =
    body.topDevices.available ? "已啟用" : body.topDevices.reason;
}

refresh();
setInterval(refresh, 5000);
