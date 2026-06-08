// ---- AI Debug Report Generator ----
// Generates a human-readable summary of all browser state for AI analysis
// Call via: fetch("/api/debug/ai-report") → returns formatted text report

(function() {
  "use strict";

  var reportEl = null;

  function $(id) { return document.getElementById(id); }

  function generateReport() {
    var d = window.collectState ? window.collectState().dom : {};
    var n = window.collectState ? window.collectState().network : {};
    var err = window.collectState ? window.collectState().consoleErrors : [];

    var lines = [];
    lines.push("=== RB5009 Traffic Monitor - Debug Report ===");
    lines.push("Timestamp: " + new Date().toISOString());
    lines.push("");

    // Network
    lines.push("--- Network ---");
    lines.push("Online: " + n.online);
    lines.push("Connection type: " + n.connectionType);
    lines.push("");

    // Status
    lines.push("--- Connection Status ---");
    lines.push("LED class: " + (d.statusLedClass || "MISSING"));
    lines.push("Status text: " + (d.statusText || "MISSING"));
    lines.push("Tab active: " + d.activeTab);
    lines.push("Current tab: " + d.currentTab);
    lines.push("");

    // Live metrics
    lines.push("--- Live Metrics ---");
    lines.push("WAN: " + d.wanNow);
    lines.push("LAN: " + d.lanNow);
    lines.push("");

    // Samples
    lines.push("--- Sample Data ---");
    lines.push("Samples map exists: " + d.samplesMapExists);
    lines.push("Samples size: " + d.samplesSize);
    lines.push("MAX_CHART_POINTS: " + d.maxChartPoints);
    if (d.samples) {
      lines.push("Interface counts:");
      for (var k in d.samples) {
        if (d.samples.hasOwnProperty(k)) {
          lines.push("  " + k + ": " + d.samples[k] + " samples");
        }
      }
    }
    lines.push("");

    // Charts
    lines.push("--- Charts ---");
    for (var chartId in d.charts) {
      if (!d.charts.hasOwnProperty(chartId)) continue;
      var c = d.charts[chartId];
      lines.push(chartId + ":");
      lines.push("  exists: " + c.exists);
      lines.push("  display size: " + c.displayWidth + "x" + c.displayHeight);
      lines.push("  has overlay: " + c.hasOverlay);
      lines.push("  overlay top: " + c.overlayTop);
      lines.push("  overlay height: " + c.overlayHeight);
      lines.push("  has data: " + c.hasData);
      lines.push("  data count: " + c.dataCount);
    }
    lines.push("");

    // Global functions
    lines.push("--- Global Functions ---");
    if (d.globalFunctions) {
      for (var fn in d.globalFunctions) {
        if (d.globalFunctions.hasOwnProperty(fn)) {
          lines.push(fn + ": " + d.globalFunctions[fn]);
        }
      }
    }
    lines.push("");

    // Panels
    lines.push("--- Panel Visibility ---");
    lines.push("Live panel visible: " + d.panelLiveVisible);
    lines.push("History panel visible: " + d.panelHistoryVisible);
    lines.push("");

    // History
    lines.push("--- History ---");
    lines.push("History stats: " + d.historyStats);
    lines.push("History zoom: " + JSON.stringify(d.historyZoom || {}));
    lines.push("");

    // Events
    lines.push("--- Events ---");
    lines.push("Events HTML (first 500 chars): " + d.eventsHtml);
    lines.push("Top devices rows: " + d.topDevicesRows);
    lines.push("");

    // Errors
    lines.push("--- Recent Errors/Warns ---");
    var errors = err.filter(function(e) { return e.level === "error" || e.level === "warn"; });
    if (errors.length === 0) {
      lines.push("No errors or warnings in the last 50 log entries.");
    } else {
      errors.forEach(function(e) {
        lines.push("[" + e.time + "] " + e.level + ": " + e.msg);
      });
    }
    lines.push("");
    lines.push("=== End Report ===");

    return lines.join("\n");
  }

  window.generateReport = generateReport;

  // Auto-generate and show report
  function showReport() {
    if (!reportEl) {
      reportEl = document.createElement("div");
      reportEl.id = "debug-report";
      reportEl.style.cssText = "position:fixed;top:60px;left:10px;width:600px;max-height:70vh;background:#1a1a2e;color:#e2e8f0;font-family:monospace;font-size:11px;padding:16px;border-radius:8px;z-index:1000;overflow:auto;border:1px solid #2d3748;display:none;";
      document.body.appendChild(reportEl);
    }
    var report = generateReport();
    reportEl.textContent = report;
    reportEl.style.display = "";
  }

  window.showDebugReport = showReport;

  // Expose for API
  window.__generateReport = generateReport;

})();
