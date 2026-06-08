// ---- History chart module ----
// Manages: history data loading, wheel zoom, range selector

var historyZoom = { start: 0, end: 1 };
var _historyLoaded = false;
var _historyRangeSeconds = 86400; // default 24h

function fmtHistoryBps(b) {
  if (b >= 1000000000) return (b / 1000000000).toFixed(2) + " Gbps";
  if (b >= 1000000) return (b / 1000000).toFixed(1) + " Mbps";
  if (b >= 1000) return (b / 1000).toFixed(0) + " Kbps";
  return b + " bps";
}

function updateHistoryStats(statsEl, maxRx, maxTx, startPt, endPt, dataLen, showZoom) {
  if (!statsEl) return;
  var parts = [
    '<span style="color:#0ea5e9">最大下載: ' + fmtHistoryBps(maxRx) + '</span>',
    '<span style="color:#f59e0b">最大上傳: ' + fmtHistoryBps(maxTx) + '</span>'
  ];
  if (showZoom && dataLen > 0) {
    parts.push('<span style="color:#718096">顯示 ' + (startPt + 1) + '-' + endPt + ' / ' + dataLen + ' 筆 (滾輪縮放, 雙擊重置)</span>');
  } else {
    parts.push('<span style="color:#718096">資料點: ' + dataLen + ' (每5秒一筆)</span>');
  }
  statsEl.innerHTML = parts.join('');
}

async function loadHistory() {
  var iface = document.getElementById("history-iface").value;
  _historyRangeSeconds = parseInt(document.getElementById("history-range").value);
  var canvas = document.getElementById("history-chart");
  if (!canvas) return;

  historyZoom = { start: 0, end: 1 };

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
    var resp = await fetch("/api/history/" + encodeURIComponent(iface) + "?range=" + _historyRangeSeconds);
    var data = await resp.json();
    if (!data || data.length < 2) {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#718096";
      ctx.font = "14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("該區間尚無資料", width / 2, height / 2);
      var statsEl = document.getElementById("history-stats");
      if (statsEl) statsEl.innerHTML = "";
      return;
    }

    var maxRx = 0, maxTx = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].rxBps > maxRx) maxRx = data[i].rxBps;
      if (data[i].txBps > maxTx) maxTx = data[i].txBps;
    }

    var statsEl = document.getElementById("history-stats");
    updateHistoryStats(statsEl, maxRx, maxTx, 0, data.length, data.length, false);

    drawLineChart("history-chart", [
      { label: "下載", color: "#0ea5e9", key: "rxBps" },
      { label: "上傳", color: "#f59e0b", key: "txBps" },
    ], data, { rangeSeconds: parseInt(_historyRangeSeconds, 10) || 86400 });

    // Setup click overlay for history chart
    setupClickOverlay("history-chart", [
      { label: "下載", color: "#0ea5e9", key: "rxBps" },
      { label: "上傳", color: "#f59e0b", key: "txBps" },
    ], data, { rangeSeconds: parseInt(_historyRangeSeconds, 10) || 86400 });

    // Wheel zoom handler
    _setupHistoryZoom(canvas, data);

  } catch (e) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f56565";
    ctx.font = "14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("載入失敗: " + e.message, width / 2, height / 2);
    // Log to debug console
    if (window.__debugLog) window.__debugLog("error", "History load failed: " + e.message + " range=" + _historyRangeSeconds + " iface=" + iface);
  }
}

function _setupHistoryZoom(canvas, fullData) {
  var overlay = canvas.__clickOverlay;
  if (!overlay) return;

  // Remove old wheel listener if any (replace)
  var newOverlay = overlay.cloneNode(true);
  overlay.parentNode.replaceChild(newOverlay, overlay);
  canvas.__clickOverlay = newOverlay;

  // Drag to pan + click to show values
  // Store fullData on canvas for drag access
  canvas.__fullData = fullData;

  var isDragging = false;
  var dragStartX = 0;
  var dragStartZoom = { start: 0, end: 1 };

  newOverlay.onmousedown = function(e) {
    if (e.button !== 0) return;
    // Only drag when zoomed in (not full range)
    if (historyZoom.end - historyZoom.start >= 0.99) {
      // Single click on unzoomed chart
      var rect2 = canvas.getBoundingClientRect();
      showClickValues(canvas, e.clientX - rect2.left, { rangeSeconds: parseInt(_historyRangeSeconds, 10) || 86400 });
      return;
    }
    isDragging = true;
    dragStartX = e.clientX;
    dragStartZoom = { start: historyZoom.start, end: historyZoom.end };
    newOverlay.style.cursor = "grabbing";
    e.preventDefault();
  };

  document.addEventListener("mousemove", function(e) {
    if (!isDragging) return;
    var hCanvas = document.getElementById("history-chart");
    var rect = hCanvas.getBoundingClientRect();
    var pad = { left: 72, right: 20, top: 28, bottom: 32 };
    var chartW = rect.width - pad.left - pad.right;
    var dx = e.clientX - dragStartX;
    var zoomSpan = dragStartZoom.end - dragStartZoom.start;
    // Convert pixel shift to data ratio shift
    var shift = -(dx / chartW) * zoomSpan;
    var newStart = dragStartZoom.start + shift;
    var newEnd = dragStartZoom.end + shift;
    // Clamp to bounds
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > 1) { newStart -= (newEnd - 1); newEnd = 1; }
    historyZoom = { start: Math.max(0, newStart), end: Math.min(1, newEnd) };
    _renderHistoryZoomed();
  });

  document.addEventListener("mouseup", function() {
    if (isDragging) {
      isDragging = false;
      newOverlay.style.cursor = "crosshair";
    }
  });

  newOverlay.addEventListener("mouseleave", function() {
    if (isDragging) {
      isDragging = false;
      newOverlay.style.cursor = "crosshair";
    }
  });

  newOverlay.onclick = function(e) {
    var rect2 = canvas.getBoundingClientRect();
    showClickValues(canvas, e.clientX - rect2.left, { rangeSeconds: parseInt(_historyRangeSeconds, 10) || 86400 });
  };

  newOverlay.addEventListener("wheel", function(e) {
    e.preventDefault();
    var hCanvas = document.getElementById("history-chart");
    var rect = hCanvas.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var dataLen = fullData.length;
    var pad = { left: 72, right: 20, top: 28, bottom: 32 };
    var chartW = rect.width - pad.left - pad.right;
    var xRatio = (mouseX - pad.left) / chartW;
    var pivotIdx = historyZoom.start + xRatio * (historyZoom.end - historyZoom.start);
    var zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
    var newSpan = (historyZoom.end - historyZoom.start) / zoomFactor;
    var minSpan = Math.max(0.01, 10 / dataLen);
    var maxSpan = 1;
    newSpan = Math.max(minSpan, Math.min(maxSpan, newSpan));
    var newStart = pivotIdx - xRatio * newSpan;
    var newEnd = pivotIdx + (1 - xRatio) * newSpan;
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > 1) { newStart -= (newEnd - 1); newEnd = 1; }
    newStart = Math.max(0, newStart);
    newEnd = Math.min(1, newEnd);
    if (newEnd - newStart >= minSpan) {
      historyZoom = { start: newStart, end: newEnd };
      var startPt = Math.floor(historyZoom.start * dataLen);
      var endPt = Math.ceil(historyZoom.end * dataLen);
      var clippedData = fullData.slice(startPt, endPt);

      drawLineChart("history-chart", [
        { label: "下載", color: "#0ea5e9", key: "rxBps" },
        { label: "上傳", color: "#f59e0b", key: "txBps" },
      ], clippedData, { rangeSeconds: parseInt(_historyRangeSeconds, 10) || 86400 });

      // Update click overlay state for zoomed data
      canvas.__clickSeries = [
        { label: "下載", color: "#0ea5e9", key: "rxBps" },
        { label: "上傳", color: "#f59e0b", key: "txBps" },
      ];
      canvas.__clickData = clippedData;

      // Update stats with zoom info
      var maxRx2 = 0, maxTx2 = 0;
      for (var i = 0; i < clippedData.length; i++) {
        if (clippedData[i].rxBps > maxRx2) maxRx2 = clippedData[i].rxBps;
        if (clippedData[i].txBps > maxTx2) maxTx2 = clippedData[i].txBps;
      }
      updateHistoryStats(document.getElementById("history-stats"), maxRx2, maxTx2, startPt, endPt, dataLen, true);
    }
  }, { passive: false });

  // Double-click to reset zoom
  newOverlay.addEventListener("dblclick", function(e) {
    e.preventDefault();
    historyZoom = { start: 0, end: 1 };
    loadHistory();
  });

  // Expose render function for drag
  window._renderHistoryZoomed = _renderHistoryZoomed;
}

function _renderHistoryZoomed() {
  var canvas = document.getElementById("history-chart");
  if (!canvas) return;
  // Use __fullData (always the full dataset), not __clickData (which gets clipped by wheel)
  var fullData = canvas.__fullData || canvas.__clickData || [];
  if (!fullData || fullData.length < 10) return;
  var dataLen = fullData.length;
  var startPt = Math.floor(historyZoom.start * dataLen);
  var endPt = Math.ceil(historyZoom.end * dataLen);
  var clippedData = fullData.slice(startPt, endPt);
  var pad = { left: 72, right: 20, top: 28, bottom: 32 };
  var rect = canvas.parentElement.getBoundingClientRect();
  var width = rect.width;
  var height = 240;
  var ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#1a1f2e";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#718096";
  ctx.font = "14px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("載入中…", width / 2, height / 2);

  try {
    var series = canvas.__clickSeries || [
      { label: "下載", color: "#0ea5e9", key: "rxBps" },
      { label: "上傳", color: "#f59e0b", key: "txBps" },
    ];
    drawLineChart("history-chart", series, clippedData, { rangeSeconds: parseInt(_historyRangeSeconds, 10) || 86400 });

    canvas.__clickSeries = series;
    canvas.__clickData = clippedData;

    var maxRx = 0, maxTx = 0;
    for (var i = 0; i < clippedData.length; i++) {
      if (clippedData[i].rxBps > maxRx) maxRx = clippedData[i].rxBps;
      if (clippedData[i].txBps > maxTx) maxTx = clippedData[i].txBps;
    }
    updateHistoryStats(document.getElementById("history-stats"), maxRx, maxTx, startPt, endPt, dataLen, true);
  } catch (e) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f56565";
    ctx.font = "14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("載入失敗: " + e.message, width / 2, height / 2);
  }
}

// Setup auto-load and range change listener
window.initHistoryChart = function() {
  var historyRangeEl = document.getElementById("history-range");
  if (historyRangeEl) {
    historyRangeEl.addEventListener("change", function() {
      loadHistory();
    });
  }

  // Auto-load on first history tab switch
  var origSwitchTab = window._switchTab;
  window._switchTab = function(tab) {
    if (origSwitchTab) origSwitchTab(tab);
    if (tab === "history" && !_historyLoaded) {
      _historyLoaded = true;
      setTimeout(function() { loadHistory(); }, 50);
    }
  };
}
