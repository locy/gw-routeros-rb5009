# RouterOS RB5009 Traffic Monitor

Real-time WAN/LAN traffic monitoring dashboard for MikroTik RouterOS devices. Built with Deno (TypeScript) + vanilla JS frontend.

**Version: `v0.2.0`**

## Features

### Real-Time Monitoring
- **WebSocket streaming** — live traffic samples pushed from server to browser at configurable intervals
- **WAN/LAN traffic cards** — horizontal metric rows showing download/upload speeds with color-coded indicators
- **Dynamic interface detection** — automatically maps RouterOS interface names to WAN/LAN slots

### Traffic Charts
- **Live chart** — real-time bandwidth visualization (WAN + LAN) with click-to-show-values
- **History chart** — historical data from SQLite with:
  - **Mouse wheel zoom** — zoom in/out relative to cursor pivot point
  - **Drag to pan** — drag to scroll through zoomed time range (keeps zoom level)
  - **Click to inspect** — click anywhere to see exact data point values with crosshair
  - **Double-click to reset** — instantly reset to full time range
  - **Time range selector** — 30min, 2h, 6h, 24h, 2d, 5d, 7d, 1month
  - **Adaptive time labels** — automatically shows HH:MM, MM/DD, or YYYY/MM/DD based on range
- **Auto-scaling Y-axis** — chart scales to actual data range for maximum visibility

### Network Analysis
- **Top IP/MAC addresses** — from active `/ip/firewall/connection` flows
- **DHCP leases** — from `/ip/dhcp-server/lease`

### Smart Events
- **Link state changes** — `link_up`, `link_down` with timestamps
- **Traffic spikes** — configurable threshold (default 1G) with spike detection
- **Performance metrics** — poll delay alerts, counter resets
- **Color-coded badges** — visual distinction between event types
- **"No recent anomalies"** — clean empty state

### History & Retention
- **SQLite storage** — persistent traffic samples with time-series index
- **Configurable retention** — automatic cleanup of old data via `/api/debug/reset`
- **Aggregation** — downsampled samples stored for long-term trends

### Debugging
- **Debug Console** — floating panel intercepting console/fetch/WS events
- **Browser state capture** — auto-sends page DOM, charts, network state to server
- **AI-assisted troubleshooting** — `/api/debug/ai-report` combines browser snapshot + server data
- **Auto-capture pipeline** — `debug.js` → `collect-state.js` → `debug-report.js`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Frontend)                                         │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐  │
│  │ shared.js│ │live-chart.js│ │history.js│ │  app.js   │  │
│  │ utilities│ │ WS + live   │ │ zoom+pan │ │ entry +   │  │
│  │ drawLine │ │ draw charts │ │ click    │ │ fetches   │  │
│  └──────────┘ └────────────┘ └──────────┘ └───────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │ WebSocket
┌────────────────────────────▼────────────────────────────────┐
│  Deno Backend (src/)                                        │
│  ┌────────────┐ ┌──────────┐ ┌──────┐ ┌──────────────┐    │
│  │ main.ts    │ │api.ts    │ │ db.ts│ │ collector.ts │    │
│  │ server +  │ │ REST +  │ │SQLite│ │ ROS polling  │    │
│  │ WS server  │ │ debug   │ │ store│ │ + event gen  │    │
│  └────────────┘ └──────────┘ └──────┘ └──────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │ routeros.ts  │  traffic.ts │ retention.ts          │    │
│  │ ROS API client│ traffic logic│ cleanup              │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────┘
                             │ TCP (port 8728)
┌────────────────────────────▼────────────────────────────────┐
│  MikroTik RouterOS (RB5009)                                 │
│  /interface/print • /ip/firewall/connection • /dhcp/lease    │
└─────────────────────────────────────────────────────────────┘
```

### Frontend Modules
| Module | Responsibility |
|--------|---------------|
| `shared.js` | Format utilities (`formatBps`, `formatTime`, `formatBytes`), `drawLineChart`, `setConnectionStatus`, `switchTab` |
| `live-chart.js` | WebSocket connection, live traffic polling, live chart rendering, click overlay |
| `history-chart.js` | History data loading, wheel zoom, drag-to-pan, time range selector |
| `app.js` | Entry point, fetches top devices/events, coordinates module initialization |
| `debug.js` | Floating debug console with intercepting fetch/WS/console |
| `collect-state.js` | Captures full browser state for remote debugging |
| `debug-report.js` | Generates human-readable summary for AI analysis |

## Quick Start

### Prerequisites
- [Deno](https://deno.land/) >= 2.0
- MikroTik RouterOS device with `/interface/print` access
- User with API permissions

### Installation

```bash
# Clone repo
git clone https://github.com/locy/gw-routeros-rb5009.git
cd gw-routeros-rb5009

# Copy env and configure
cp .env.example .env
# Edit .env with your RouterOS credentials

# Run
deno task serve
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTEROS_HOST` | *(required)* | RouterOS IP address |
| `ROUTEROS_USER` | *(required)* | API username |
| `ROUTEROS_PASSWORD` | *(required)* | API password |
| `ROUTEROS_PORT` | `8728` | RouterOS API port |
| `WAN_INTERFACE` | *(required)* | WAN interface name (e.g., `bridge-WAN`) |
| `LAN_INTERFACE` | *(required)* | LAN interface name (e.g., `bridge-LAN`) |
| `POLL_INTERVAL_SECONDS` | `5` | Polling interval |
| `DATABASE_PATH` | `./data/monitor.sqlite3` | SQLite database location |
| `BIND_HOST` | `0.0.0.0` | Server bind address |
| `BIND_PORT` | `8080` | Server port |
| `SPIKE_THRESHOLD_BPS` | `1G` | Traffic spike threshold (supports `1G`, `100M`, `500K`) |

### RouterOS Setup

```bash
# Enable API
/ip service enable api

# Create monitoring user
/user add name=monitor password=mon942200 policy=api,read,write
```

## API Endpoints

### REST
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Server status, top devices, recent events |
| `/api/history/:iface?range=86400` | GET | Historical samples (range in seconds) |
| `/api/events` | GET | Recent events |
| `/api/debug/snapshot` | POST | Save browser snapshot |
| `/api/debug/ai-report` | GET | Combined browser + server debug report |
| `/api/debug/reset` | POST | Reset debug state |
| `/api/debug/check` | GET | Check debug pipeline status |

### WebSocket
| Endpoint | Description |
|----------|-------------|
| `ws://host:port/ws` | Real-time traffic samples |

## Development

```bash
# Run tests
deno test

# Run specific test
deno test tests/collector_test.ts

# Format
deno fmt

# Type check
deno check src/main.ts
```

## Versioning

Uses [semver](https://semver.org/). Version auto-increment:

```bash
./scripts/bump-version.sh patch    # 0.2.0 → 0.2.1
./scripts/bump-version.sh minor    # 0.2.0 → 0.3.0
./scripts/bump-version.sh major    # 0.2.0 → 1.0.0
```

The script:
1. Updates `deno.json` version field
2. Creates git tag `vX.Y.Z`
3. Pushes to remote

### Git Hooks
`post-commit` hook detects commits since last tag and prompts for version bump.

## Debug Console

Press `F12` or click the 🐛 button to open the debug console. Shows:
- WebSocket connection status
- Fetch request/response log
- Console messages
- Browser state (DOM, charts, globals, network)
- AI report generation button

## License

MIT
