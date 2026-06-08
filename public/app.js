// ---- State ----

var samples = new Map();
var MAX_CHART_POINTS = 120;

// ---- Connection status indicator ----

function setConnectionStatus(color, text) {
  var indicator = document.getElementById("status-indicator");
  if (!indicator) return;
  var led = indicator.querySelector(".led");
  var label = indicator.querySelector(".status-text");
  led.className = "led " + color;
  label.textContent = text;
}

// ---- Color helpers ----

function mbps(value) {
  var abs = Math.abs(value);
  if (abs < 1000) return abs.toFixed(0) + " bps";
  if (abs < 1000000) return (abs / 1000).toFixed(0) + " Kbps";
  return (abs / 1000000).toFixed(2) + " Mbps";
}

function colorForBps(bps) {
  if (bps === 0) return "#4b5563";
  if (bps < 1000000) return "#67e8f9";
  if (bps < 10000000) return "#60a5fa";
  return "#a78bfa";
}

function formatTime(dateStr) {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return "??:??";
  var hh = d.getHours().toString().padStart(2, "0");
  var mm = d.getMinutes().toString().padStart(2, "0");
  return hh + ":" + mm;
}

// ---- WebSocket connection ----

function connectWS() {
  var proto = location.protocol === "https:" ? "wss:" : "ws:";
  var ws = new WebSocket(proto + "//" + location.host + "/ws");

  ws.onopen = function () {
    setConnectionStatus("green", "即時連線已就緒");
  };

  ws.onmessage = function (ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg.type === "sample") {
        console.log("[WS] received:", msg.payload.interface, "rx:", msg.payload.rxBps);
        var sample = msg.payload;
        if (!samples.has(sample.interface)) {
          samples.set(sample.interface, []);
        }
        var arr = samples.get(sample.interface);
        arr.push(sample);
        while (arr.length > MAX_CHART_POINTS) arr.shift();
        // Force DOM update
        setTimeout(function () {
          updateLiveDisplay();
          drawCharts();
        }, 0);
      }
    } catch (e) {
      // ignore
    }
  };

  ws.onclose = function () {
    setConnectionStatus("yellow", "連線中斷，3 秒後重連…");
    setTimeout(connectWS, 3000);
  };
}

// ---- Live display update (from WS only) ----

function updateLiveDisplay() {
  var wanEl = document.getElementById("wan-now");
  var lanEl = document.getElementById("lan-now");

  var wanArr = samples.get("ether1");
  if (wanArr && wanArr.length > 0) {
    var w = wanArr[wanArr.length - 1];
    if (wanEl) {
      wanEl.innerHTML = '<span style="color:' + colorForBps(w.rxBps) + '">' + mbps(w.rxBps) + ' ↓</span>' +
        ' / ' +
        '<span style="color:' + colorForBps(w.txBps) + '">' + mbps(w.txBps) + ' ↑</span>';
    }
  }

  var lanArr = samples.get("bridge");
  if (lanArr && lanArr.length > 0) {
    var l = lanArr[lanArr.length - 1];
    if (lanEl) {
      lanEl.innerHTML = '<span style="color:' + colorForBps(l.rxBps) + '">' + mbps(l.rxBps) + ' ↓</span>' +
        ' / ' +
        '<span style="color:' + colorForBps(l.txBps) + '">' + mbps(l.txBps) + ' ↑</span>';
    }
  }
}

// ---- Canvas chart ----

function drawCharts() {
  var ether = samples.get("ether1");
  console.log("[drawCharts] ether samples:", ether ? ether.length : "undefined");
  if (ether && ether.length > 0) {
    console.log("[drawCharts] first sample:", ether[0].timestamp, ether[0].rxBps);
  }
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

  // Force canvas sizing based on parent container
  var rect = canvas.parentElement.getBoundingClientRect();
  var width = rect.width;
  var height = 240;
  var dpr = window.devicePixelRatio || 1;

  // Set actual canvas size (scaled for retina)
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  // Set CSS size
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";

  ctx.scale(dpr, dpr);

  // Clear entire canvas
  ctx.clearRect(0, 0, width, height);

  var pad = { top: 28, right: 20, bottom: 32, left: 72 };
  var chartW = width - pad.left - pad.right;
  var chartH = height - pad.top - pad.bottom;

  if (data.length < 2) {
    ctx.fillStyle = "#4b5563";
    ctx.font = "14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("累積至少 2 筆資料後繪製圖表", width / 2, height / 2);
    return;
  }

  // Compute global max across all series in dataset
  var globalMax = 1;
  for (var s = 0; s < series.length; s++) {
    for (var i = 0; i < data.length; i++) {
      var v = Math.abs(Number(data[i][series[s].key]));
      if (v > globalMax) globalMax = v;
    }
  }
  // Round up to nice scale
  var exp = Math.pow(10, Math.ceil(Math.log10(globalMax)) - 1);
  globalMax = exp;

  // ---- Grid lines ----
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (chartH / 4) * g;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(width - pad.right, gy);
    ctx.stroke();

    // Y-axis labels
    var val = globalMax - (globalMax / 4) * g;
    ctx.fillStyle = "#64748b";
    ctx.font = "11px Inter, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(mbps(val), pad.left - 8, gy);
  }
  ctx.setLineDash([]);

  // ---- X-axis time labels ----
  ctx.fillStyle = "#64748b";
  ctx.font = "11px Inter, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  var step = Math.max(1, Math.floor(data.length / 8));
  for (var xi = 0; xi < data.length; xi += step) {
    var xPos = pad.left + (xi / (data.length - 1)) * chartW;
    ctx.fillText(formatTime(data[xi].timestamp), xPos, height - 12);
  }

  // ---- Draw lines ----
  for (var si = 0; si < series.length; si++) {
    var s = series[si];
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    for (var li = 0; li < data.length; li++) {
      var v = Number(data[li][s.key]) || 0;
      var x = pad.left + (li / (data.length - 1)) * chartW;
      var y = pad.top + chartH - (Math.abs(v) / globalMax) * chartH;

      if (li === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Last point dot
    if (data.length > 0) {
      var lastVal = Number(data[data.length - 1][s.key]) || 0;
      var dotX = pad.left + chartW;
      var dotY = pad.top + chartH - (Math.abs(lastVal) / globalMax) * chartH;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- Legend ----
  ctx.font = "12px Inter, sans-serif";
  var legendX = pad.left;
  for (var ls = 0; ls < series.length; ls++) {
    var leg = series[ls];
    ctx.fillStyle = leg.color;
    ctx.fillRect(legendX, 6, 12, 12);
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(leg.label, legendX + 16, 8);
    legendX += ctx.measureText(leg.label).width + 36;
  }
}

// ---- Init ----

connectWS();
