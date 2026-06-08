// ---- Live chart module ----
// Manages: WebSocket, WAN/LAN data, live display, live chart rendering, click overlay

var wanKey = null;
var lanKey = null;
var wanK = null;
var lanK = null;
var wanEl = null;
var lanEl = null;

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

function colorForBps(bps) {
  if (bps === 0) return "#4b5563";
  if (bps < 1000000) return "#67e8f9";
  if (bps < 10000000) return "#60a5fa";
  return "#a78bfa";
}

window.updateLiveDisplay = function() {
  var currentWanK = findInterfaceKey("wan");
  var currentLanK = findInterfaceKey("lan");

  if (currentWanK) {
    var wanArr = samples.get(currentWanK);
    if (wanArr && wanArr.length > 0) {
      var w = wanArr[wanArr.length - 1];
      if (wanEl) {
        wanEl.innerHTML = '<span style="color:' + colorForBps(w.rxBps) + '">' + formatBps(w.rxBps) + ' ↓</span>' +
          ' / ' +
          '<span style="color:' + colorForBps(w.txBps) + '">' + formatBps(w.txBps) + ' ↑</span>';
      }
    }
  }

  if (currentLanK) {
    var lanArr = samples.get(currentLanK);
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

window.drawCharts = function() {
  var wanK = findInterfaceKey("wan");
  var lanK = findInterfaceKey("lan");
  var wanData = samples.get(wanK) || [];
  var lanData = samples.get(lanK) || [];

  drawLineChart("live-chart", [
    { label: "WAN ↓", color: "#0ea5e9", key: "rxBps" },
    { label: "WAN ↑", color: "#f59e0b", key: "txBps" },
  ], wanData);
  setupClickOverlay("live-chart", [
    { label: "WAN ↓", color: "#0ea5e9", key: "rxBps" },
    { label: "WAN ↑", color: "#f59e0b", key: "txBps" },
  ], wanData);

  drawLineChart("live-chart-lan", [
    { label: "LAN ↓", color: "#10b981", key: "rxBps" },
    { label: "LAN ↑", color: "#8b5cf6", key: "txBps" },
  ], lanData);
  setupClickOverlay("live-chart-lan", [
    { label: "LAN ↓", color: "#10b981", key: "rxBps" },
    { label: "LAN ↑", color: "#8b5cf6", key: "txBps" },
  ], lanData);
}

// ---- WebSocket connection ----

window.connectWS = function() {
  var proto = location.protocol === "https:" ? "wss:" : "ws:";
  var ws = new WebSocket(proto + "//" + location.host + "/ws");

  ws.addEventListener("open", function () {
    console.log("[WS] onopen firing");
    if (typeof setConnectionStatus === "function") {
      setConnectionStatus("green", "online");
      console.log("[WS] status set to online");
    } else {
      console.error("[WS] setConnectionStatus not found!");
    }
  });

  ws.addEventListener("message", function (ev) {
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
        setTimeout(function () {
          updateLiveDisplay();
          drawCharts();
        }, 0);
      }
    } catch (e) {
      // ignore
    }
  });

  ws.addEventListener("close", function (ev) {
    console.log("[WS] onclose code=" + ev.code + " reason=" + ev.reason);
    if (typeof setConnectionStatus === "function") {
      setConnectionStatus("yellow", "offline");
      console.log("[WS] status set to offline");
    }
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener("error", function (err) {
    console.log("[WS] error event", err);
  });
}

// ---- Click overlay to show point values ----
// Shared between live and history: click on chart overlay shows crosshair + tooltip

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

  var xRatio = (mouseX - pad.left) / chartW;
  var idx = Math.round(xRatio * (data.length - 1));
  idx = Math.max(0, Math.min(data.length - 1, idx));

  // Redraw clean chart
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Recalculate display params
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

  var chartH2 = canvas.__clickChartH;

  // Grid
  ctx.strokeStyle = "#2d3748"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (chartH2 / 4) * g;
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
      var y = pad.top + chartH2 - ((av - yMin) / chartRange) * chartH2;
      y = Math.max(pad.top, Math.min(pad.top + chartH2, y));
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

  // Crosshair + dots + tooltip
  var pointX = pad.left + (idx / (data.length - 1)) * chartW;

  ctx.strokeStyle = "#4a5568"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(pointX, pad.top); ctx.lineTo(pointX, pad.top + chartH2); ctx.stroke();
  ctx.setLineDash([]);

  for (var si2 = 0; si2 < series.length; si2++) {
    var val = Number(data[idx][series[si2].key]) || 0;
    var dotY = pad.top + chartH2 - ((Math.abs(val) - yMin) / chartRange) * chartH2;
    dotY = Math.max(pad.top, Math.min(pad.top + chartH2, dotY));
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

  canvas.__clickOverlay._shownIdx = idx;
}

function setupClickOverlay(canvasId, series, data) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;

  var rect = canvas.parentElement.getBoundingClientRect();
  var width = rect.width;
  var height = 240;
  var pad = { top: 28, right: 20, bottom: 32, left: 72 };
  var chartW = width - pad.left - pad.right;
  var chartH = height - pad.top - pad.bottom;

  // Compute yMin/chartRange from data (same logic as drawLineChart)
  var yMin = 0;
  var chartRange = 1;
  if (data && data.length > 0) {
    var minVal = Infinity, maxVal = -Infinity;
    for (var i = 0; i < data.length; i++) {
      for (var s = 0; s < series.length; s++) {
        var v = Math.abs(Number(data[i][series[s].key]));
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
    minVal = Math.max(0, minVal);
    var rng = maxVal - minVal;
    if (rng < 100) rng = 100;
    var padding = rng * 0.1;
    yMin = minVal - padding;
    if (yMin < 0) yMin = 0;
    var yMax = maxVal + padding;
    chartRange = yMax - yMin || 1;
  }

  // Store click state
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
  // Position overlay
  var panelRect = canvas.parentElement.getBoundingClientRect();
  var canvasRect = canvas.getBoundingClientRect();
  var overlayTop = canvasRect.top - panelRect.top;
  canvas.__clickOverlay.style.top = overlayTop + "px";
  canvas.__clickOverlay.style.height = (canvasRect.height) + "px";

  canvas.__clickOverlay.onclick = function(e) {
    var rect2 = canvas.getBoundingClientRect();
    showClickValues(canvas, e.clientX - rect2.left);
  };
}

function refreshClickOverlay(canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  // Re-position overlay
  var panelRect = canvas.parentElement.getBoundingClientRect();
  var canvasRect = canvas.getBoundingClientRect();
  canvas.__clickOverlay.style.top = (canvasRect.top - panelRect.top) + "px";
  canvas.__clickOverlay.style.height = (canvasRect.height) + "px";
}
