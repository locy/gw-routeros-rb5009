// ---- Collect State ----
// Gathers full page state snapshot for AI debugging
// Returns a structured object with all relevant context

(function() {
  "use strict";

  var _stateHistory = [];
  var MAX_HISTORY = 50;

  // ---- Helper ----
  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function collectDomState() {
    var result = {};

    // Status indicator
    var si = $("status-indicator");
    if (si) {
      var led = si.querySelector(".led");
      var text = si.querySelector(".status-text");
      result.statusLedClass = led ? led.className : "MISSING";
      result.statusText = text ? text.textContent : "MISSING";
      result.statusVisible = true;
    } else {
      result.statusVisible = false;
    }

    // Live metrics
    var wanNow = $("wan-now");
    var lanNow = $("lan-now");
    result.wanNow = wanNow ? wanNow.innerHTML : "MISSING";
    result.lanNow = lanNow ? lanNow.innerHTML : "MISSING";

    // Tab state
    result.activeTab = $(".tab-btn.active") ? $(".tab-btn.active").id : "none";

    // Charts - check canvas sizes and overlay state
    var canvasIds = ["live-chart", "live-chart-lan", "history-chart"];
    result.charts = {};
    canvasIds.forEach(function(id) {
      var canvas = $(id);
      if (!canvas) {
        result.charts[id] = { exists: false };
        return;
      }
      var rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : null;
      var parentRect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : null;
      result.charts[id] = {
        exists: true,
        displayWidth: rect ? rect.width : 0,
        displayHeight: rect ? rect.height : 0,
        hasOverlay: !!(canvas.__clickOverlay),
        overlayTop: canvas.__clickOverlay ? canvas.__clickOverlay.style.top : "none",
        overlayHeight: canvas.__clickOverlay ? canvas.__clickOverlay.style.height : "none",
        hasData: !!(canvas.__clickData && canvas.__clickData.length > 0),
        dataCount: canvas.__clickData ? canvas.__clickData.length : 0
      };
    });

    // Samples in memory
    if (window.samples) {
      result.samples = {};
      window.samples.forEach(function(arr, key) {
        result.samples[key] = arr.length;
      });
    }

    // History zoom state
    if (window.historyZoom) {
      result.historyZoom = window.historyZoom;
    }

    // Events panel
    var events = $("events");
    result.eventsHtml = events ? events.innerHTML.substring(0, 500) : "MISSING";

    // Top devices table
    var topDevices = $("top-devices");
    result.topDevicesRows = topDevices ? topDevices.querySelectorAll("tr").length : 0;

    // History stats
    var histStats = $("history-stats");
    result.historyStats = histStats ? histStats.textContent : "none";

    // Panel visibility
    result.panelLiveVisible = $("panel-live") ? $("panel-live").style.display !== "none" : false;
    result.panelHistoryVisible = $("panel-history") ? $("panel-history").style.display !== "none" : false;

    // Global functions check
    var neededFuncs = [
      "setConnectionStatus", "switchTab", "connectWS", "initHistoryChart",
      "drawLineChart", "showClickValues", "setupClickOverlay",
      "updateLiveDisplay", "drawCharts", "loadHistory",
      "formatBytes", "formatBps", "formatTime"
    ];
    result.globalFunctions = {};
    neededFuncs.forEach(function(name) {
      result.globalFunctions[name] = typeof window[name] === "function" ? "OK" : "MISSING";
    });

    // Global state check
    result.samplesMapExists = !!(window.samples && window.samples instanceof Map);
    result.samplesSize = window.samples ? window.samples.size : 0;
    result.maxChartPoints = window.MAX_CHART_POINTS || "undefined";

    // Connection state
    result.currentTab = window.currentTab || "undefined";

    return result;
  }

  function collectConsoleErrors() {
    // Use Performance API to get long task and error info
    var errors = [];
    if (window.__debugLog) {
      errors = window.__debugLog.slice(-50); // last 50 log entries
    }
    return errors;
  }

  function collectNetworkState() {
    return {
      online: navigator.onLine,
      connectionType: navigator.connection ? navigator.connection.effectiveType : "unknown"
    };
  }

  // ---- Public API ----
  window.collectState = function() {
    var snapshot = {
      timestamp: new Date().toISOString(),
      dom: collectDomState(),
      network: collectNetworkState(),
      consoleErrors: collectConsoleErrors()
    };

    _stateHistory.push(snapshot);
    if (_stateHistory.length > MAX_HISTORY) _stateHistory.shift();

    return snapshot;
  };

  // ---- Auto-capture on events ----
  window.addEventListener("error", function(ev) {
    if (!window.__debugLog) window.__debugLog = [];
    window.__debugLog.push({ time: Date.now(), level: "error", msg: ev.message + " at " + ev.filename + ":" + ev.lineno, data: null });
    if (window.__collectStateOnEvent) {
      var snap = window.collectState();
      snap.trigger = "error";
      snap.error = { message: ev.message, filename: ev.filename, lineno: ev.lineno };
      // Auto-send via fetch
      try {
        fetch("/api/debug/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snap)
        }).catch(function() { /* endpoint may not exist yet */ });
      } catch(e) {}
    }
  });

  // ---- Expose for AI integration ----
  // GET /api/debug/state → returns latest snapshot
  // POST /api/debug/snapshot → receives snapshot from browser
  // GET /api/debug/history → returns recent snapshots
  window.__getDebugHistory = function() { return _stateHistory.slice(-20); };
  window.__setCollectStateOnEvent = function(val) { window.__collectStateOnEvent = val; };

  // Auto-capture every 30 seconds for polling
  setInterval(function() {
    if (window.__collectStateOnEvent) {
      window.collectState();
    }
  }, 30000);

})();
