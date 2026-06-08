type TrafficSample = {
  interface: string;
  timestamp: string;
  rxBps: number;
  txBps: number;
  rxBytes: number;
  txBytes: number;
  linkUp: boolean;
  valid: boolean;
};

type StatusResponse = {
  interfaces: Record<string, TrafficSample | null>;
  topDevices: { available: boolean; reason: string; items: unknown[] };
};

function mbps(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1_000) return `${abs.toFixed(0)} bps`;
  if (abs < 1_000_000) return `${(abs / 1_000).toFixed(0)} Kbps`;
  return `${(abs / 1_000_000).toFixed(2)} Mbps`;
}

// ---- WebSocket connection ----

const samples = new Map<string, TrafficSample[]>();
const MAX_CHART_POINTS = 120; // keep ~10 min at 5s interval

function connectWS(): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    const el = document.querySelector("#stale-state") as HTMLElement;
    if (el) el.textContent = "即時連線已就緒";
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "sample") {
        const sample = msg.payload as TrafficSample;
        if (!samples.has(sample.interface)) {
          samples.set(sample.interface, []);
        }
        const arr = samples.get(sample.interface)!;
        arr.push(sample);
        while (arr.length > MAX_CHART_POINTS) arr.shift();
        drawCharts();
        updateLiveDisplay();
      }
    } catch {
      // ignore malformed
    }
  };

  ws.onclose = () => {
    const el = document.querySelector("#stale-state") as HTMLElement;
    if (el) el.textContent = "連線中斷，3 秒後重連…";
    setTimeout(connectWS, 3000);
  };
}

// ---- Live display update (from WS or polling) ----

function updateLiveDisplay(): void {
  for (const [iface, arr] of samples) {
    if (arr.length === 0) continue;
    const last = arr[arr.length - 1];
    const elId = iface === "ether1" ? "wan-now" : "lan-now";
    const el = document.querySelector(`#${elId}`) as HTMLElement;
    if (el) {
      el.textContent = `${mbps(last.rxBps)} ↓ / ↑ ${mbps(last.txBps)}`;
    }
  }
}

// ---- Polling for initial status + top devices ----

async function refreshStatus(): Promise<void> {
  try {
    const res = await fetch("/api/status");
    const body = await res.json() as StatusResponse;
    const names = Object.keys(body.interfaces);
    const wan = body.interfaces[names[0]];
    const lan = body.interfaces[names[1]];
    const wanEl = document.querySelector("#wan-now") as HTMLElement;
    const lanEl = document.querySelector("#lan-now") as HTMLElement;
    if (wanEl) wanEl.textContent = wan
      ? `${mbps(wan.rxBps)} ↓ / ↑ ${mbps(wan.txBps)}`
      : "等待資料";
    if (lanEl) lanEl.textContent = lan
      ? `${mbps(lan.rxBps)} ↓ / ↑ ${mbps(lan.txBps)}`
      : "等待資料";
    const tdEl = document.querySelector("#top-devices") as HTMLElement;
    if (tdEl) {
      tdEl.textContent = body.topDevices.available
        ? "已啟用"
        : body.topDevices.reason;
    }
  } catch {
    // ignore
  }
}

// ---- Canvas chart ----

interface ChartSeries {
  label: string;
  color: string;
  key: keyof TrafficSample;
}

function drawCharts(): void {
  drawLineChart("live-chart", [
    { label: "WAN ↓", color: "#0ea5e9", key: "rxBps" },
    { label: "WAN ↑", color: "#f59e0b", key: "txBps" },
  ], samples.get("ether1") ?? []);

  drawLineChart("live-chart-lan", [
    { label: "LAN ↓", color: "#10b981", key: "rxBps" },
    { label: "LAN ↑", color: "#8b5cf6", key: "txBps" },
  ], samples.get("bridge") ?? []);
}

function drawLineChart(
  canvasId: string,
  series: ChartSeries[],
  data: TrafficSample[],
): void {
  const canvas = document.querySelector(`#${canvasId}`) as HTMLCanvasElement | null;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;

  ctx.clearRect(0, 0, W, H);

  if (data.length < 2) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("累積至少 2 筆資料後繪製圖表", W / 2, H / 2);
    return;
  }

  const pad = { top: 24, right: 16, bottom: 28, left: 64 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  // Compute global max across all series
  let globalMax = 1;
  for (const s of series) {
    for (const pt of data) {
      const v = Math.abs(Number(pt[s.key]));
      if (v > globalMax) globalMax = v;
    }
  }
  // Round up to nice scale
  const exp = Math.pow(10, Math.ceil(Math.log10(globalMax)) - 1);
  globalMax = exp;

  // Grid
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (cH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();

    const val = globalMax - (globalMax / 4) * i;
    ctx.fillStyle = "#6b7280";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(mbps(val), pad.left - 6, y + 4);
  }
  ctx.setLineDash([]);

  // X labels
  ctx.fillStyle = "#6b7280";
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  const step = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += step) {
    const x = pad.left + (i / (data.length - 1)) * cW;
    const t = new Date(data[i].timestamp);
    ctx.fillText(
      `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`,
      x, H - 6,
    );
  }

  // Lines
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < data.length; i++) {
      const v = Number(data[i][s.key]);
      const x = pad.left + (i / (data.length - 1)) * cW;
      const y = pad.top + cH - (Math.abs(v) / globalMax) * cH;
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Last point dot
    const last = data[data.length - 1];
    const lx = pad.left + cW;
    const ly = pad.top + cH - (Math.abs(Number(last[s.key])) / globalMax) * cH;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend
  ctx.font = "12px Inter, sans-serif";
  let lx = pad.left;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 4, 12, 12);
    ctx.fillStyle = "#374151";
    ctx.textAlign = "left";
    ctx.fillText(s.label, lx + 16, 14);
    lx += ctx.measureText(s.label).width + 32;
  }
}

// ---- Events ----

async function refreshEvents(): Promise<void> {
  try {
    const res = await fetch("/api/events");
    const events = await res.json() as Array<{
      timestamp: string; type: string; interface: string | null; message: string;
    }>;
    const list = document.querySelector("#events") as HTMLElement | null;
    if (!list) return;
    list.innerHTML = "";
    for (const e of events.slice(0, 10)) {
      const li = document.createElement("li");
      li.style.cssText = "padding:4px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;";
      const t = new Date(e.timestamp);
      li.textContent = `[${t.toLocaleString()}] ${e.type}${e.interface ? ` (${e.interface})` : ""} ${e.message}`;
      list.appendChild(li);
    }
  } catch {
    // ignore
  }
}

// ---- Init ----

connectWS();
refreshStatus();
refreshEvents();
setInterval(refreshStatus, 5000);
setInterval(refreshEvents, 10000);
