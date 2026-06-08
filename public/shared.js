// ---- Shared utilities (imported by live-chart.js and history-chart.js) ----

// State
var samples = new Map();
var MAX_CHART_POINTS = 120;

// ---- Format bytes helper ----

function formatBytes(n) {
  if (n < 1024) return n.toString();
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

// ---- Color helpers ----

function formatBps(value) {
  var abs = Math.abs(value);
  if (abs < 1000) return abs.toFixed(0) + " b";
  if (abs < 1000000) return (abs / 1000).toFixed(1) + " kb";
  return (abs / 1000000).toFixed(2) + " Mb";
}

function formatTime(dateStr, rangeSeconds) {
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return "??:??";
  var hh = d.getHours().toString().padStart(2, "0");
  var mm = d.getMinutes().toString().padStart(2, "0");
  var timeStr = hh + ":" + mm;
  // Show date based on range
  if (rangeSeconds) {
    if (rangeSeconds <= 1800) { // ≤ 30min: no date needed
      return timeStr;
    } else if (rangeSeconds <= 86400) { // ≤ 24h: show HH:MM only
      return timeStr;
    } else if (rangeSeconds <= 7 * 86400) { // ≤ 7d: show MM-DD
      var mon = (d.getMonth() + 1).toString().padStart(2, "0");
      var day = d.getDate().toString().padStart(2, "0");
      return mon + "/" + day + " " + timeStr;
    } else { // > 7d: show YYYY-MM-DD
      var year = d.getFullYear();
      var mon = (d.getMonth() + 1).toString().padStart(2, "0");
      var day = d.getDate().toString().padStart(2, "0");
      return year + "/" + mon + "/" + day + " " + timeStr;
    }
  }
  return timeStr;
}

// ---- Canvas chart rendering ----
// Shared between live-chart.js and history-chart.js

function drawLineChart(canvasId, series, data, opts) {
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
  if (range < 100) range = 100;
  var padding = range * 0.1;
  var yMin = minVal - padding;
  var yMax = maxVal + padding;
  if (yMin < 0) yMin = 0;
  var chartRange = yMax - yMin || 1;

  // Round yMax to nice scale for display
  var scaleExp = Math.pow(10, Math.floor(Math.log10(yMax)));
  var displayMax = Math.ceil(yMax / scaleExp) * scaleExp;
  var displayMin = Math.max(0, Math.floor(minVal / scaleExp) * scaleExp);
  var displayRange = displayMax - displayMin || 1;

  // Store params
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
    ctx.fillText(formatTime(data[xi].timestamp, opts && opts.rangeSeconds), xPos, height - 12);
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
      if (li === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
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

// ---- Tab switching ----

var currentTab = "live";

function switchTab(tab) {
  currentTab = tab;
  document.getElementById("tab-live").classList.toggle("active", tab === "live");
  document.getElementById("tab-history").classList.toggle("active", tab === "history");
  document.getElementById("panel-live").style.display = tab === "live" ? "" : "none";
  document.getElementById("panel-live-lan").style.display = tab === "live" ? "" : "none";
  document.getElementById("panel-history").style.display = tab === "history" ? "" : "none";
}
window._switchTab = switchTab;
