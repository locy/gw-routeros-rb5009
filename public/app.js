const samples = new Map();
const MAX_CHART_POINTS = 120;

function mbps(value) {
  const abs = Math.abs(value);
  if (abs < 1_000) return abs.toFixed(0) + " bps";
  if (abs < 1_000_000) return (abs / 1_000).toFixed(0) + " Kbps";
  return (abs / 1_000_000).toFixed(2) + " Mbps";
}

// ---- WebSocket connection ----

function connectWS() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(proto + "//" + location.host + "/ws");

  ws.onopen = function () {
    const el = document.querySelector("#stale-state");
    if (el) el.textContent = "即時連線已就緒";
  };

  ws.onmessage = function (ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg.type === "sample") {
        var sample = msg.payload;
        if (!samples.has(sample.interface)) {
          samples.set(sample.interface, []);
        }
        var arr = samples.get(sample.interface);
        arr.push(sample);
        while (arr.length > MAX_CHART_POINTS) arr.shift();
        drawCharts();
        updateLiveDisplay();
      }
    } catch (e) {
      // ignore
    }
  };

  ws.onclose = function () {
    var el = document.querySelector("#stale-state");
    if (el) el.textContent = "連線中斷，3 秒後重連…";
    setTimeout(connectWS, 3000);
  };
}

// ---- Live display update ----

function updateLiveDisplay() {
  samples.forEach(function (arr, iface) {
    if (arr.length === 0) return;
    var last = arr[arr.length - 1];
    var elId = iface === "ether1" ? "wan-now" : "lan-now";
    var el = document.querySelector("#" + elId);
    if (el) {
      el.textContent = mbps(last.rxBps) + " ↓ / ↑ " + mbps(last.txBps);
    }
  });
}

// ---- Polling for initial status + top devices ----

async function refreshStatus() {
  try {
    var res = await fetch("/api/status");
    var body = await res.json();
    var names = Object.keys(body.interfaces);
    var wan = body.interfaces[names[0]];
    var lan = body.interfaces[names[1]];
    var wanEl = document.querySelector("#wan-now");
    var lanEl = document.querySelector("#lan-now");
    if (wanEl && wan) {
      wanEl.textContent = mbps(wan.rxBps) + " ↓ / ↑ " + mbps(wan.txBps);
    } else if (wanEl) {
      wanEl.textContent = "等待資料";
    }
    if (lanEl && lan) {
      lanEl.textContent = mbps(lan.rxBps) + " ↓ / ↑ " + mbps(lan.txBps);
    } else if (lanEl) {
      lanEl.textContent = "等待資料";
    }
    var tdEl = document.querySelector("#top-devices");
    if (tdEl) {
      tdEl.textContent = body.topDevices.available
        ? "已啟用"
        : body.topDevices.reason;
    }
  } catch (e) {
    // ignore
  }
}

// ---- Canvas chart ----

function drawCharts() {
  drawLineChart("live-chart", [
    { label: "WAN ↓", color: "#0ea5e9", key: "rxBps" },
    { label: "WAN ↑", color: "#f59e0b", key: "txBps" },
  ], samples.get("ether1") || []);

  drawLineChart("live-chart-lan", [
    { label: "LAN ↓", color: "#10b981", key: "rxBps" },
    { label: "LAN ↑", color: "#8b5cf6", key: "txBps" },
  ], samples.get("bridge") || []);
}

function drawLineChart(canvasId, series, data) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  var W = rect.width;
  var H = rect.height;

  ctx.clearRect(0, 0, W, H);

  if (data.length < 2) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("累積至少 2 筆資料後繪製圖表", W / 2, H / 2);
    return;
  }

  var pad = { top: 24, right: 16, bottom: 28, left: 64 };
  var cW = W - pad.left - pad.right;
  var cH = H - pad.top - pad.bottom;

  // Compute global max
  var globalMax = 1;
  for (var s = 0; s < series.length; s++) {
    for (var i = 0; i < data.length; i++) {
      var v = Math.abs(Number(data[i][series[s].key]));
      if (v > globalMax) globalMax = v;
    }
  }
  var exp = Math.pow(10, Math.ceil(Math.log10(globalMax)) - 1);
  globalMax = exp;

  // Grid
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (var g = 0; g <= 4; g++) {
    var y = pad.top + (cH / 4) * g;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();

    var val = globalMax - (globalMax / 4) * g;
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
  var step = Math.max(1, Math.floor(data.length / 6));
  for (var xi = 0; xi < data.length; xi += step) {
    var x = pad.left + (xi / (data.length - 1)) * cW;
    var t = new Date(data[xi].timestamp);
    var hh = t.getHours().toString().padStart(2, "0");
    var mm = t.getMinutes().toString().padStart(2, "0");
    ctx.fillText(hh + ":" + mm, x, H - 6);
  }

  // Lines
  for (var si = 0; si < series.length; si++) {
    ctx.strokeStyle = series[si].color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    var first = true;
    for (var li = 0; li < data.length; li++) {
      var val = Number(data[li][series[si].key]);
      var lx2 = pad.left + (li / (data.length - 1)) * cW;
      var ly = pad.top + cH - (Math.abs(val) / globalMax) * cH;
      if (first) {
        ctx.moveTo(lx2, ly);
        first = false;
      } else {
        ctx.lineTo(lx2, ly);
      }
    }
    ctx.stroke();

    // Last point dot
    var lastPt = data[data.length - 1];
    var dotX = pad.left + cW;
    var dotY = pad.top + cH - (Math.abs(Number(lastPt[series[si].key])) / globalMax) * cH;
    ctx.fillStyle = series[si].color;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend
  ctx.font = "12px Inter, sans-serif";
  var legendX = pad.left;
  for (var ls = 0; ls < series.length; ls++) {
    ctx.fillStyle = series[ls].color;
    ctx.fillRect(legendX, 4, 12, 12);
    ctx.fillStyle = "#374151";
    ctx.textAlign = "left";
    ctx.fillText(series[ls].label, legendX + 16, 14);
    legendX += ctx.measureText(series[ls].label).width + 32;
  }
}

// ---- Events ----

async function refreshEvents() {
  try {
    var res = await fetch("/api/events");
    var events = await res.json();
    var list = document.querySelector("#events");
    if (!list) return;
    list.innerHTML = "";
    for (var ei = 0; ei < Math.min(10, events.length); ei++) {
      var e = events[ei];
      var li = document.createElement("li");
      li.style.cssText = "padding:4px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;";
      var t = new Date(e.timestamp);
      var text = "[" + t.toLocaleString() + "] " + e.type;
      if (e.interface) text += " (" + e.interface + ")";
      text += " " + e.message;
      li.textContent = text;
      list.appendChild(li);
    }
  } catch (e) {
    // ignore
  }
}

// ---- Init ----

connectWS();
refreshStatus();
refreshEvents();
setInterval(refreshStatus, 5000);
setInterval(refreshEvents, 10000);
