// ---- Main entry point ----
// Imports: shared.js (format utilities, drawLineChart), live-chart.js, history-chart.js

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
  } catch (e) { /* ignore */ }
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
    const staleTypes = ['missing_interface', 'poll_delay'];
    const isStale = data.every(e => staleTypes.includes(e.type));
    if (isStale) {
      ul.innerHTML = '<li style="color:#718096">最近無異常事件</li>';
      return;
    }
    let html = "";
    for (const e of data) {
      const ts = e.timestamp ? e.timestamp.slice(11, 16) : "??:??";
      var typeColor = "#a0aec0";
      switch (e.type) {
        case "link_down": case "traffic_spike_down":
          typeColor = "#f56565"; break;
        case "link_up": case "traffic_spike_up":
          typeColor = "#48bb78"; break;
        case "counter_reset": case "poll_delay":
          typeColor = "#ed8936"; break;
        case "collector_error":
          typeColor = "#e53e3e"; break;
        case "missing_interface":
          typeColor = "#a0aec0"; break;
      }
      html += '<li>' + ts + ' <span style="color:' + typeColor + '">[' + e.type + ']</span>' +
        (e.interface ? ' <span style="color:#60a5fa">' + e.interface + '</span>' : '') +
        ' ' + (e.message || '') + '</li>';
    }
    ul.innerHTML = html;
  } catch (e) { /* ignore */ }
}

// ---- Init periodic fetches ----

function startPeriodicFetches() {
  fetchTopDevices();
  fetchEvents();
  setInterval(fetchTopDevices, 15000);
  setInterval(fetchEvents, 30000);
}

var _tabLiveEl = document.getElementById("tab-live");
var _tabHistoryEl = document.getElementById("tab-history");

if (_tabLiveEl) _tabLiveEl.addEventListener("click", function() { switchTab("live"); });
if (_tabHistoryEl) _tabHistoryEl.addEventListener("click", function() { switchTab("history"); });
window._switchTab = switchTab;

// ---- Init ----
// Delay init until live-chart.js loads connectWS and drawCharts
function waitForInit() {
  if (typeof window.connectWS === "function") {
    // Ensure all scripts (including extensions) have loaded
    setTimeout(function() {
      // Initialize DOM element references for live-chart.js
      wanEl = document.getElementById("wan-now");
      lanEl = document.getElementById("lan-now");
      window.connectWS();
      startPeriodicFetches();
      window.initHistoryChart();
    }, 200);
    // Re-apply tab click handlers after init
    var liveEl = document.getElementById("tab-live");
    var histEl = document.getElementById("tab-history");
    if (liveEl) {
      liveEl.addEventListener("click", function() { switchTab("live"); });
    }
    if (histEl) {
      histEl.addEventListener("click", function() {
        window._switchTab("history");
      });
    }
  } else {
    setTimeout(waitForInit, 50);
  }
}

// Start initialization
waitForInit();
