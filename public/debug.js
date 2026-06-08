// ---- Browser Debug Console ----
// Adds a persistent debug panel overlay to monitor runtime issues
// Usage: just include this script; panel appears in bottom-right corner

(function() {
  "use strict";

  // ---- Debug state ----
  var debugLog = [];
  var MAX_LOGS = 200;
  var panelOpen = false;
  var logLevel = "all"; // "all", "error", "warn", "info"

  // ---- DOM helpers ----
  function $(sel) { return document.querySelector(sel); }
  function $(id) { return document.getElementById(id); }

  // ---- Create debug panel ----
  var panel = null;

  function initPanel() {
    panel = document.createElement("div");
    panel.id = "debug-panel";
    panel.innerHTML = `
      <div class="debug-header">
        <span class="debug-title">🐛 Debug Console</span>
        <div class="debug-controls">
          <select id="debug-level">
            <option value="all" selected>All</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
          </select>
          <button id="debug-collect">📸 Collect</button>
          <button id="debug-send">📡 Send</button>
          <button id="debug-ai-report">🤖 AI Report</button>
          <button id="debug-clear">Clear</button>
          <button id="debug-toggle">▼</button>
        </div>
      </div>
      <div id="debug-log" class="debug-log"></div>
    `;
    document.body.appendChild(panel);

    var dbgLevel = document.getElementById("debug-level");
    if (dbgLevel) dbgLevel.addEventListener("change", function() {
      logLevel = this.value;
      renderLogs();
    });
    var dbgClear = document.getElementById("debug-clear");
    if (dbgClear) dbgClear.addEventListener("click", function() {
      debugLog = [];
      renderLogs();
    });
    var dbgCollect = document.getElementById("debug-collect");
    if (dbgCollect) dbgCollect.addEventListener("click", function() {
      if (window.collectState) {
        var snap = window.collectState();
        addLog("info", "State snapshot collected: " + Object.keys(snap.dom).length + " keys");
      }
    });
    var dbgSend = document.getElementById("debug-send");
    if (dbgSend) dbgSend.addEventListener("click", function() {
      if (window.collectState) {
        var snap = window.collectState();
        fetch("/api/debug/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snap)
        }).then(function(r) { return r.json(); }).then(function(data) {
          addLog("info", "Snapshot sent: " + data.total + " stored");
        }).catch(function(err) {
          addLog("error", "Send failed: " + err.message);
        });
      }
    });
    var dbgAiReport = document.getElementById("debug-ai-report");
    if (dbgAiReport) dbgAiReport.addEventListener("click", function() {
      addLog("info", "Fetching AI debug report from server...");
      fetch("/api/debug/ai-report")
        .then(function(r) { return r.text(); })
        .then(function(report) {
          // Copy to clipboard
          if (navigator.clipboard) {
            navigator.clipboard.writeText(report).then(function() {
              addLog("info", "AI report generated and copied to clipboard (" + report.length + " chars)");
            }).catch(function() {
              addLog("info", "AI report generated (" + report.length + " chars). Select and copy manually.");
            });
          } else {
            addLog("info", "AI report generated (" + report.length + " chars). Select and copy manually.");
          }
        })
        .catch(function(err) {
          addLog("error", "AI report failed: " + err.message);
        });
    });
    var dbgToggle = document.getElementById("debug-toggle");
    if (dbgToggle) dbgToggle.addEventListener("click", function() {
      panelOpen = !panelOpen;
      this.textContent = panelOpen ? "▲" : "▼";
      var dbgLog = document.getElementById("debug-log");
      if (dbgLog) dbgLog.style.display = panelOpen ? "" : "none";
    });
  }

  // ---- Logging ----
  function addLog(level, msg, data) {
    var entry = {
      time: new Date().toLocaleTimeString("zh-TW", { hour12: false }),
      level: level,
      msg: msg,
      data: data
    };
    debugLog.push(entry);
    if (debugLog.length > MAX_LOGS) debugLog.shift();
    if (panelOpen || level === "error") renderLogs();
  }

  function renderLogs() {
    var logEl = document.getElementById("debug-log");
    if (!logEl) return;
    var filtered = debugLog.filter(function(e) {
      if (logLevel === "all") return true;
      return e.level === logLevel;
    });
    logEl.innerHTML = filtered.map(function(e) {
      var color = "#718096";
      if (e.level === "error") color = "#f56565";
      if (e.level === "warn") color = "#ecc94b";
      var dataStr = e.data ? " <span style='color:#60a5fa'>" + escapeHtml(JSON.stringify(e.data).slice(0, 200)) + "</span>" : "";
      return '<div class="debug-entry" style="border-left-color:' + color + '">' +
        '<span class="debug-ts">' + e.time + '</span> ' +
        '<span style="color:' + color + '">' + escapeHtml(e.msg) + '</span>' +
        dataStr + '</div>';
    }).join("");
    // Auto-scroll
    logEl.scrollTop = logEl.scrollHeight;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- Override console methods to capture ----
  var origConsole = {};
  ["log", "warn", "error", "info", "debug"].forEach(function(method) {
    if (console[method]) {
      origConsole[method] = console[method];
      console[method] = function() {
        // Capture and forward
        var args = Array.prototype.slice.call(arguments);
        var msg = args.map(function(a) {
          if (typeof a === "string") return a;
          try { return JSON.stringify(a); } catch(e) { return String(a); }
        }).join(" ");
        addLog(method === "error" ? "error" : method === "warn" ? "warn" : "info", msg);
        if (origConsole[method]) origConsole[method].apply(console, arguments);
      };
    }
  });

  // ---- Intercept fetch ----
  var origFetch = window.fetch;
  window.fetch = function() {
    var url = arguments[0];
    addLog("info", "fetch → " + (typeof url === "string" ? url : url.url));
    return origFetch.apply(window, arguments).then(function(resp) {
      addLog("info", "fetch ← " + url + " status=" + resp.status);
      return resp;
    }).catch(function(err) {
      addLog("error", "fetch ✗ " + url + " " + err.message);
      throw err;
    });
  };

  // ---- Intercept WebSocket ----
  var origWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    addLog("info", "WS connecting to " + url);
    var ws = new origWebSocket(url, protocols);

    ws.addEventListener("open", function() {
      addLog("info", "WS connected ✓ " + url);
    });

    ws.addEventListener("message", function(ev) {
      try {
        var data = JSON.parse(ev.data);
        if (data.type === "sample") {
          addLog("info", "WS sample ← " + data.payload.interface + " rx=" + data.payload.rxBps + " tx=" + data.payload.txBps);
        }
      } catch(e) { /* not JSON */ }
    });

    ws.addEventListener("close", function(ev) {
      addLog("warn", "WS closed " + url + " code=" + ev.code + " reason=" + ev.reason);
    });

    ws.addEventListener("error", function(err) {
      addLog("error", "WS error " + url);
    });

    return ws;
  };
  window.WebSocket.prototype = origWebSocket.prototype;

  // ---- Monitor DOM state ----
  function monitorElement(id, label) {
    if (!id) return;
    var el = $(id);
    if (!el) {
      addLog("error", "MISSING DOM element: #" + id);
    } else {
      addLog("info", "DOM OK: #" + id + " (" + label + ")");
    }
  }

  // ---- Global error handler ----
  window.addEventListener("error", function(ev) {
    addLog("error", "JS Error: " + ev.message + " at " + ev.filename + ":" + ev.lineno);
  });

  window.addEventListener("unhandledrejection", function(ev) {
    addLog("error", "Unhandled Promise: " + String(ev.reason));
  });

  // ---- Expose state for collect-state.js ----
  window.__debugLog = debugLog;
  window.__collectStateOnEvent = true;

  // ---- Auto-start ----
  initPanel();

  // Check all critical DOM elements
  setTimeout(function() {
    addLog("info", "=== Page loaded ===");
    monitorElement("status-indicator", "status");
    monitorElement("wan-now", "WAN metric");
    monitorElement("lan-now", "LAN metric");
    monitorElement("live-chart", "WAN chart canvas");
    monitorElement("live-chart-lan", "LAN chart canvas");
    monitorElement("history-chart", "History chart canvas");
    monitorElement("history-iface", "History interface selector");
    monitorElement("history-range", "History range selector");
    monitorElement("top-devices", "Top devices table");
    monitorElement("events", "Events list");

    // Check global functions
    var funcs = ["setConnectionStatus", "switchTab", "connectWS", "initHistoryChart"];
    funcs.forEach(function(f) {
      if (typeof window[f] === "function") {
        addLog("info", "Global OK: " + f);
      } else {
        addLog("warn", "Global MISSING: " + f);
      }
    });

    addLog("info", "=== Debug setup complete ===");

    // Auto-send snapshot after 3s for AI debugging
    setTimeout(function() {
      if (window.collectState) {
        var snap = window.collectState();
        fetch("/api/debug/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snap)
        }).then(function(r) { return r.json(); }).then(function(data) {
          addLog("info", "Auto-sent snapshot: " + data.total + " stored");
        }).catch(function(err) {
          addLog("error", "Auto-send failed: " + err.message);
        });
      }
    }, 3000);
  }, 1000);

})();
