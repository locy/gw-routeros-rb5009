// ---- State ----

var samples = new Map();
var MAX_CHART_POINTS = 120;

// ---- Format bytes helper ----

function formatBytes(n) {
  if (n < 1024) return n.toString();
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

// ---- Fetch top devices ----

async function fetchTopDevices() {
  try {
    const resp = await fetch("/api/status");
    const data = await resp.json();
    const table = document.getElementById("top-devices");
    if (!table) return;
    if (!data.topDevices || !data.topDevices.available || data.topDevices.items.length === 0) {
      table.innerHTML = '<tr><td style="color:#718096">尚未取得 Top IP 資料</td></tr>';
      return;
    }
    let html = '<thead><tr><th>IP</th><th>MAC</th><th>Host</th><th>Bytes</th><th>Packets</th></tr></thead><tbody>';
    for (const d of data.topDevices.items) {
      html += '<tr><td style="color:#e2e8f0">' + d.ip + '</td>';
      html += '<td style="color:#a0aec0">' + d.mac + '</td>';
      html += '<td style="color:#a0aec0">' + (d.hostname || "-") + '</td>';
      html += '<td style="color:#60a5fa">' + formatBytes(d.bytes) + '</td>';
      html += '<td style="color:#60a5fa">' + d.packets.toLocaleString() + '</td></tr>';
    }
    html += '</tbody>';
    table.innerHTML = html;
  } catch (e) {
    // ignore
  }
}

// ---- Fetch events ----

async function fetchEvents() {
  try {
    const resp = await fetch("/api/events");
    const data = await resp.json();
    const ul = document.getElementById("events");
    if (!ul) return;
    if (!data || data.length === 0) {
      ul.innerHTML = '<li style="color:#718096">無事件</li>';
      return;
    }
    // Filter out old stale bridge missing_interface events
    const staleTypes = ['missing_interface', 'poll_delay'];
    const isStale = data.every(e => staleTypes.includes(e.type));
    if (isStale) {
      ul.innerHTML = '<li style="color:#718096">最近無異常事件</li>';
      return;
    }
    let html = "";
    for (const e of data) {
      const ts = e.timestamp ? e.timestamp.slice(11, 16) : "??:??";
      // Color code event types
      var typeColor = "#a0aec0";
      switch (e.type) {
        case "link_down": case "traffic_spike_down":
          typeColor = "#f56565"; break; // red
        case "link_up": case "traffic_spike_up":
          typeColor = "#48bb78"; break; // green
        case "counter_reset": case "poll_delay":
          typeColor = "#ed8936"; break; // orange
        case "collector_error":
          typeColor = "#e53e3e"; break; // dark red
        case "missing_interface":
          typeColor = "#a0aec0"; break; // gray
      }
      html += '<li>' + ts + ' <span style="color:' + typeColor + '">[' + e.type + ']</span>' +
        (e.interface ? ' <span style="color:#60a5fa">' + e.interface + '</span>' : '') +
        ' ' + (e.message || '') + '</li>';
    }
    ul.innerHTML = html;
  } catch (e) {
    // ignore
  }
}

// ---- Init periodic fetches ----

function startPeriodicFetches() {
  fetchTopDevices();
  fetchEvents();
  setInterval(fetchTopDevices, 15000); // top devices every 15s
  setInterval(fetchEvents, 30000); // events every 30s
}

// ---- Connection status indicator ----

function setConnectionStatus(color, text) {
  var indicator = document.getElementById("status-indicator");
  if (!indicator) return;
  var led = indicator.querySelector(".led");
  var label = indicator.querySelector(".status-text");
  led.className = "led " + color;
  label.textContent = text.toUpperCase();
}

// ---- Color helpers ----

function formatBps(value) {
  var abs = Math.abs(value);
  if (abs < 1000) return abs.toFixed(0) + " b";
  if (abs < 1000000) return (abs / 1000).toFixed(1) + " kb";
  return (abs / 1000000).toFixed(2) + " Mb";
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
    setConnectionStatus("green", "online");
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
    setConnectionStatus("yellow", "offline");
    setTimeout(connectWS, 3000);
  };
}

// ---- Live display update (from WS only) ----

function updateLiveDisplay() {
  var wanEl = document.getElementById("wan-now");
  var lanEl = document.getElementById("lan-now");

  // Use dynamic interface keys from collected samples
  var wanKey = wanKey || findInterfaceKey("wan");
  var lanKey = lanKey || findInterfaceKey("lan");

  if (wanKey) {
    var wanArr = samples.get(wanKey);
    if (wanArr && wanArr.length > 0) {
      var w = wanArr[wanArr.length - 1];
      if (wanEl) {
        wanEl.innerHTML = '<span style="color:' + colorForBps(w.rxBps) + '">' + formatBps(w.rxBps) + ' ↓</span>' +
          ' / ' +
          '<span style="color:' + colorForBps(w.txBps) + '">' + formatBps(w.txBps) + ' ↑</span>';
      }
    }
  }

  if (lanKey) {
    var lanArr = samples.get(lanKey);
    if (lanArr && lanArr.length > 0) {
      var l = lanArr[lanArr.length - 1];
      if (lanEl) {
        lanEl.innerHTML = '<span style="color:' + colorForBps(l.rxBps) + '">' + formatBps(l.rxBps) + ' ↓</span>' +
          ' / ' +
          '<span style="color:' + colorForBps(l.txBps) + '">' + formatBps(l.txBps) + ' ↑</span>';
      }
    }
  }
}

var wanKey = null;
var lanKey = null;
function findInterfaceKey(role) {
  if (role === "wan" && wanKey) return wanKey;
  if (role === "lan" && lanKey) return lanKey;
  var keys = Array.from(samples.keys());
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i].toLowerCase();
    if (k.indexOf("wan") >= 0) { wanKey = wanKey || keys[i]; if (role === "wan") return keys[i]; }
    if (k.indexOf("lan") >= 0) { lanKey = lanKey || keys[i]; if (role === "lan") return keys[i]; }
  }
  return null;
}

// ---- Canvas chart ----

function drawCharts() {
  var wanK = findInterfaceKey("wan");
  var lanK = findInterfaceKey("lan");

  drawLineChart("live-chart", [
    { label: "WAN ↓", color: "#0ea5e9", key: "rxBps" },
    { label: "WAN ↑", color: "#f59e0b", key: "txBps" },
  ], samples.get(wanK) || []);

  drawLineChart("live-chart-lan", [
    { label: "LAN ↓", color: "#10b981", key: "rxBps" },
    { label: "LAN ↑", color: "#8b5cf6", key: "txBps" },
  ], samples.get(lanK) || []);
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

  // Compute min/max value across all series in dataset (auto-scale)
  var minVal = Infinity;
  var maxVal = -Infinity;
  for (var s = 0; s < series.length; s++) {
    for (var i = 0; i < data.length; i++) {
      var v = Math.abs(Number(data[i][series[s].key]));
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }
  // Ensure minVal is at least 0, add padding
  minVal = Math.max(0, minVal);
  var range = maxVal - minVal;
  if (range < 100) range = 100; // minimum 100 bps range for visibility
  var padding = range * 0.1; // 10% padding
  var yMin = minVal - padding;
  var yMax = maxVal + padding;
  if (yMin < 0) yMin = 0;
  var chartRange = yMax - yMin || 1;

  // Round yMax to nice scale for display
  var scaleExp = Math.pow(10, Math.floor(Math.log10(yMax)));
  var displayMax = Math.ceil(yMax / scaleExp) * scaleExp;
  var displayMin = Math.max(0, Math.floor(minVal / scaleExp) * scaleExp);
  var displayRange = displayMax - displayMin || 1;

  // Store params for hover interaction
  canvas.__chartParams = {
    pad: pad, chartW: chartW, chartH: chartH,
    yMin: yMin, yMax: yMax, chartRange: chartRange,
    displayMin: displayMin, displayMax: displayMax, displayRange: displayRange,
  };

  // ---- Grid lines ----
  ctx.strokeStyle = "#2d3748";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (chartH / 4) * g;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(width - pad.right, gy);
    ctx.stroke();

    // Y-axis labels (auto-scaled)
    var val = displayMax - (displayRange / 4) * g;
    ctx.fillStyle = "#64748b";
    ctx.font = "11px Inter, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatBps(val), pad.left - 8, gy);
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
      var av = Math.abs(v);
      var x = pad.left + (li / (data.length - 1)) * chartW;
      var y = pad.top + chartH - ((av - yMin) / chartRange) * chartH;
      if (y < pad.top) y = pad.top;
      if (y > pad.top + chartH) y = pad.top + chartH;

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
      var dotY = pad.top + chartH - (Math.abs(lastVal) - yMin) / chartRange * chartH;
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

  // ---- Click overlay to show point values ----
  canvas.__clickSeries = series;
  canvas.__clickData = data;
  canvas.__clickPad = pad;
  canvas.__clickChartW = chartW;
  canvas.__clickChartH = chartH;
  canvas.__clickYMin = yMin;
  canvas.__clickChartRange = chartRange;
  canvas.__clickWidth = width;
  canvas.__clickHeight = height;

  if (!canvas.__clickOverlay) {
    canvas.parentElement.style.position = "relative";
    var overlayDiv = document.createElement("div");
    overlayDiv.style.cssText = "position:absolute;left:0;width:100%;cursor:crosshair;z-index:1;background:transparent";
    canvas.parentElement.insertBefore(overlayDiv, canvas.nextSibling);
    canvas.__clickOverlay = overlayDiv;
  }
  // Always position overlay exactly over the chart area
  if (canvas.__clickOverlay && canvas.__clickHeight) {
    var panelRect = canvas.parentElement.getBoundingClientRect();
    var canvasRect = canvas.getBoundingClientRect();
    var overlayTop = canvasRect.top - panelRect.top;
    canvas.__clickOverlay.style.top = overlayTop + "px";
    canvas.__clickOverlay.style.height = (canvasRect.height) + "px";
  }
  canvas.__clickOverlay.onclick = function(e) {
    var rect = canvas.getBoundingClientRect();
    showClickValues(canvas, e.clientX - rect.left);
  };
}

function showClickValues(canvas, mouseX) {
  var series = canvas.__clickSeries;
  var data = canvas.__clickData;
  if (!data || data.length < 2 || !series) return;

  var pad = canvas.__clickPad;
  var chartW = canvas.__clickChartW;
  var chartH = canvas.__clickChartH;
  var yMin = canvas.__clickYMin;
  var chartRange = canvas.__clickChartRange;
  var width = canvas.__clickWidth;
  var height = canvas.__clickHeight;
  if (!pad || chartW <= 0 || chartH <= 0) return;

  // Find nearest data point
  var xRatio = (mouseX - pad.left) / chartW;
  var idx = Math.round(xRatio * (data.length - 1));
  idx = Math.max(0, Math.min(data.length - 1, idx));

  // Redraw clean chart
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Recalculate display params (same as drawLineChart)
  var minVal = Infinity, maxVal = -Infinity;
  for (var s = 0; s < series.length; s++) {
    for (var i = 0; i < data.length; i++) {
      var v = Math.abs(Number(data[i][series[s].key]));
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }
  minVal = Math.max(0, minVal);
  var range = maxVal - minVal;
  if (range < 100) range = 100;
  var padding = range * 0.1;
  yMin = minVal - padding;
  var yMax = maxVal + padding;
  if (yMin < 0) yMin = 0;
  chartRange = yMax - yMin || 1;
  var scaleExp = Math.pow(10, Math.floor(Math.log10(yMax)));
  var displayMax = Math.ceil(yMax / scaleExp) * scaleExp;
  var displayMin = Math.max(0, Math.floor(minVal / scaleExp) * scaleExp);
  var displayRange = displayMax - displayMin || 1;
  var displayChartRange = chartH;

  // Grid
  var chartH = canvas.__clickChartH;
  ctx.strokeStyle = "#2d3748"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (chartH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(width - pad.right, gy); ctx.stroke();
    var val = displayMax - (displayRange / 4) * g;
    ctx.fillStyle = "#64748b"; ctx.font = "11px Inter, monospace";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(formatBps(val), pad.left - 8, gy);
  }
  ctx.setLineDash([]);

  // Time labels
  ctx.fillStyle = "#64748b"; ctx.font = "11px Inter, monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  var step = Math.max(1, Math.floor(data.length / 8));
  for (var xi = 0; xi < data.length; xi += step) {
    var xPos = pad.left + (xi / (data.length - 1)) * chartW;
    ctx.fillText(formatTime(data[xi].timestamp), xPos, height - 12);
  }

  // Lines
  for (var si = 0; si < series.length; si++) {
    var s = series[si];
    ctx.strokeStyle = s.color; ctx.lineWidth = 2;
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
    for (var li = 0; li < data.length; li++) {
      var v = Number(data[li][s.key]) || 0;
      var av = Math.abs(v);
      var x = pad.left + (li / (data.length - 1)) * chartW;
      var y = pad.top + chartH - ((av - yMin) / chartRange) * chartH;
      y = Math.max(pad.top, Math.min(pad.top + chartH, y));
      if (li === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Legend
  ctx.font = "12px Inter, sans-serif";
  var legendX = pad.left;
  for (var ls = 0; ls < series.length; ls++) {
    var leg = series[ls];
    ctx.fillStyle = leg.color;
    ctx.fillRect(legendX, 6, 12, 12);
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(leg.label, legendX + 16, 8);
    legendX += ctx.measureText(leg.label).width + 36;
  }
  ctx.restore();

  // Click overlay: crosshair + dots + tooltip
  var pointX = pad.left + (idx / (data.length - 1)) * chartW;
  var chartH = canvas.__clickChartH;

  // Crosshair
  ctx.strokeStyle = "#4a5568"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(pointX, pad.top); ctx.lineTo(pointX, pad.top + chartH); ctx.stroke();
  ctx.setLineDash([]);

  // Dots on each series
  for (var si2 = 0; si2 < series.length; si2++) {
    var val = Number(data[idx][series[si2].key]) || 0;
    var dotY = pad.top + chartH - ((Math.abs(val) - yMin) / chartRange) * chartH;
    dotY = Math.max(pad.top, Math.min(pad.top + chartH, dotY));
    ctx.fillStyle = series[si2].color; ctx.beginPath();
    ctx.arc(pointX, dotY, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#0b0f19"; ctx.lineWidth = 2; ctx.stroke();
  }

  // Tooltip
  var tooltipX = pointX + 12;
  var tooltipMaxW = 180;
  if (tooltipX + tooltipMaxW > width) tooltipX = pointX - tooltipMaxW - 12;
  if (tooltipX < pad.left) tooltipX = pad.left;
  var tooltipY = pad.top + 10;

  ctx.fillStyle = "rgba(11,15,25,0.95)";
  ctx.fillRect(tooltipX, tooltipY, tooltipMaxW, 22 * (series.length + 1));
  ctx.strokeStyle = "#2d3748"; ctx.lineWidth = 1;
  ctx.strokeRect(tooltipX, tooltipY, tooltipMaxW, 22 * (series.length + 1));
  ctx.font = "14px Inter, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";

  for (var si3 = 0; si3 < series.length; si3++) {
    var v2 = Number(data[idx][series[si3].key]) || 0;
    ctx.fillStyle = series[si3].color;
    ctx.fillText(series[si3].label + ": " + formatBps(Math.abs(v2)), tooltipX + 6, tooltipY + 4 + si3 * 22);
  }
  var t = data[idx].timestamp;
  ctx.fillStyle = "#718096";
  ctx.fillText(t ? t.toTimeString().slice(0, 8) : "", tooltipX + 6, tooltipY + (series.length + 1) * 22 - 18);

  // Store for redraw detection
  canvas.__clickOverlay._shownIdx = idx;
}

// ---- Tab switching ---

var currentTab = "live";

function switchTab(tab) {
  currentTab = tab;
  document.getElementById("tab-live").classList.toggle("active", tab === "live");
  document.getElementById("tab-history").classList.toggle("active", tab === "history");
  document.getElementById("panel-live").style.display = tab === "live" ? "" : "none";
  document.getElementById("panel-live-lan").style.display = tab === "live" ? "" : "none";
  document.getElementById("panel-history").style.display = tab === "history" ? "" : "none";
}

document.getElementById("tab-live").addEventListener("click", function() { switchTab("live"); });
document.getElementById("tab-history").addEventListener("click", function() { switchTab("history"); });

// ---- History chart ----

async function loadHistory() {
  var iface = document.getElementById("history-iface").value;
  var range = parseInt(document.getElementById("history-range").value);
  var canvas = document.getElementById("history-chart");
  if (!canvas) return;

  // Draw loading state
  var ctx = canvas.getContext("2d");
  var rect = canvas.parentElement.getBoundingClientRect();
  var width = rect.width;
  var height = 240;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#718096";
  ctx.font = "14px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("載入中…", width / 2, height / 2);

  try {
    var resp = await fetch("/api/history/" + encodeURIComponent(iface) + "?range=" + range);
    var data = await resp.json();
    if (!data || data.length < 2) {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#718096";
      ctx.font = "14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("該區間尚無資料", width / 2, height / 2);
      document.getElementById("history-stats").innerHTML = "";
      return;
    }

    // Compute max values
    var maxRx = 0, maxTx = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].rxBps > maxRx) maxRx = data[i].rxBps;
      if (data[i].txBps > maxTx) maxTx = data[i].txBps;
    }
    function fmtBps(b) {
      if (b >= 1000000000) return (b / 1000000000).toFixed(2) + " Gbps";
      if (b >= 1000000) return (b / 1000000).toFixed(1) + " Mbps";
      if (b >= 1000) return (b / 1000).toFixed(0) + " Kbps";
      return b + " bps";
    }
    document.getElementById("history-stats").innerHTML =
      '<span style="color:#0ea5e9">最大下載: ' + fmtBps(maxRx) + '</span>' +
      '<span style="color:#f59e0b">最大上傳: ' + fmtBps(maxTx) + '</span>' +
      '<span style="color:#718096">資料點: ' + data.length + ' (每5秒一筆)</span>';

    drawLineChart("history-chart", [
      { label: "下載", color: "#0ea5e9", key: "rxBps" },
      { label: "上傳", color: "#f59e0b", key: "txBps" },
    ], data);
  } catch (e) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f56565";
    ctx.font = "14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("載入失敗: " + e.message, width / 2, height / 2);
  }
}

document.getElementById("btn-load-history").addEventListener("click", loadHistory);

// ---- Init ----

connectWS();
startPeriodicFetches();
