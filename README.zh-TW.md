# RouterOS RB5009 即時流量監控儀表板

MikroTik RouterOS 裝置的即時 WAN/LAN 流量監控儀表板。使用 Deno (TypeScript) + 原生 JS 前端開發。

**版本：`v0.2.0`**

## 功能特色

### 即時監控
- **WebSocket 即時推播** — 以可配置間隔從伺服器推播即時流量樣本到瀏覽器
- **WAN/LAN 流量卡片** — 水平排列的指標列，顯示下載/上傳速度並以顏色區分狀態
- **動態介面偵測** — 自動將 RouterOS 介面名稱對應到 WAN/LAN 顯示區域

### 流量圖表
- **即時圖表** — 即時頻寬視覺化（WAN + LAN），支援點擊顯示數值
- **歷史圖表** — 來自 SQLite 的歷史資料，具備：
  - **滑鼠滾輪縮放** — 以游標為錨點進行縮放
  - **拖曳平移** — 拖曳瀏覽縮放後的時間範圍（保持縮放比例）
  - **點擊檢視** — 點擊任意位置顯示精確資料點數值與十字線
  - **雙擊重置** — 立即返回完整時間範圍
  - **時間範圍選擇器** — 30 分鐘、2 小時、6 小時、24 小時、2 天、5 天、7 天、1 個月
  - **自適應時間標籤** — 依範圍自動顯示 HH:MM、MM/DD 或 YYYY/MM/DD
- **Y 軸自動縮放** — 圖表根據實際資料範圍自動調整，確保可視性

### 網路分析
- **Top IP/MAC 地址** — 來自活躍的 `/ip/firewall/connection` 連線
- **DHCP 租約** — 來自 `/ip/dhcp-server/lease`

### 智慧事件
- **鏈路狀態變更** — `link_up`、`link_down` 含時間戳記
- **流量尖峰** — 可配置閾值（預設 1G）並自動偵測
- **效能指標** — 輪詢延遲警告、計數器重置
- **顏色標示徽章** — 視覺化區分不同事件類型
- **「近期無異常」** — 空狀態時的友善提示

### 歷史資料與保留
- **SQLite 儲存** — 時間序列索引的持久化流量樣本
- **可配置保留期** — 透過 `/api/debug/reset` 自動清理舊資料
- **資料聚合** — 降採樣樣本用於長期趨勢

### 除錯工具
- **除錯控制台** — 浮動面板攔截 console/fetch/WS 事件
- **瀏覽器狀態擷取** — 自動將頁面 DOM、圖表、網路狀態傳送至伺服器
- **AI 輔助除錯** — `/api/debug/ai-report` 整合瀏覽器與伺服器資料
- **自動擷取流程** — `debug.js` → `collect-state.js` → `debug-report.js`

## 系統架構

```
┌─────────────────────────────────────────────────────────────┐
│  瀏覽器（前端）                                             │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐  │
│  │ shared.js│ │live-chart.js│ │history.js│ │  app.js   │  │
│  │ 公用程式 │ │WS + 即時   │ │ 縮放+拖曳│ │ 入口 + 輪詢│  │
│  │ 繪圖函式│ │ 繪圖       │ │ 點擊     │ │ 請求       │  │
│  └──────────┘ └────────────┘ └──────────┘ └───────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │ WebSocket
┌────────────────────────────▼────────────────────────────────┐
│  Deno 後端 (src/)                                           │
│  ┌────────────┐ ┌──────────┐ ┌──────┐ ┌──────────────┐    │
│  │ main.ts    │ │api.ts    │ │ db.ts│ │ collector.ts │    │
│  │ 伺服器 +  │ │REST + 除  │ │SQLite│ │ROS 輪詢     │    │
│  │ WS 伺服器  │ │錯端點    │ │儲存  │ │ + 事件產生   │    │
│  └────────────┘ └──────────┘ └──────┘ └──────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │ routeros.ts  │  traffic.ts │ retention.ts          │    │
│  │ ROS API 用戶端│ 流量邏輯  │ 資料清理               │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────┘
                             │ TCP（埠 8728）
┌────────────────────────────▼────────────────────────────────┐
│  MikroTik RouterOS (RB5009)                                 │
│  /interface/print • /ip/firewall/connection • /dhcp/lease    │
└─────────────────────────────────────────────────────────────┘
```

### 前端模組
| 模組 | 功能 |
|------|------|
| `shared.js` | 格式化工具（`formatBps`、`formatTime`、`formatBytes`）、`drawLineChart`、`setConnectionStatus`、`switchTab` |
| `live-chart.js` | WebSocket 連線、即時流量輪詢、即時圖表繪製、點擊覆蓋 |
| `history-chart.js` | 歷史資料載入、滾輪縮放、拖曳平移、時間範圍選擇器 |
| `app.js` | 入口點、取得裝置/事件資訊、協調模組初始化 |
| `debug.js` | 浮動除錯控制台，攔截 fetch/WS/console |
| `collect-state.js` | 擷取完整瀏覽器狀態供遠端除錯 |
| `debug-report.js` | 產生 AI 可分析的可讀摘要 |

## 快速開始

### 環境需求
- [Deno](https://deno.land/) >= 2.0
- 具備 `/interface/print` 存取權限的 MikroTik RouterOS 裝置
- 擁有 API 權限的使用者帳號

### 安裝

```bash
# 克隆專案
git clone https://github.com/locy/gw-routeros-rb5009.git
cd gw-routeros-rb5009

# 複製環境設定並修改
cp .env.example .env
# 編輯 .env 填入 RouterOS 連線資訊

# 啟動
deno task serve
```

### 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `ROUTEROS_HOST` | 必填 | RouterOS IP 位址 |
| `ROUTEROS_USER` | 必填 | API 使用者名稱 |
| `ROUTEROS_PASSWORD` | 必填 | API 密碼 |
| `ROUTEROS_PORT` | `8728` | RouterOS API 埠號 |
| `WAN_INTERFACE` | 必填 | WAN 介面名稱（例如 `bridge-WAN`） |
| `LAN_INTERFACE` | 必填 | LAN 介面名稱（例如 `bridge-LAN`） |
| `POLL_INTERVAL_SECONDS` | `5` | 輪詢間隔（秒） |
| `DATABASE_PATH` | `./data/monitor.sqlite3` | SQLite 資料庫位置 |
| `BIND_HOST` | `0.0.0.0` | 伺服器綁定位址 |
| `BIND_PORT` | `8080` | 伺服器埠號 |
| `SPIKE_THRESHOLD_BPS` | `1G` | 流量尖峰閾值（支援 `1G`、`100M`、`500K`） |

### RouterOS 設定

```bash
# 啟用 API
/ip service enable api

# 建立監控使用者
/user add name=monitor password=mon942200 policy=api,read,write
```

## API 端點

### REST
| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/status` | GET | 伺服器狀態、Top 裝置、近期事件 |
| `/api/history/:iface?range=86400` | GET | 歷史樣本（range 為秒數） |
| `/api/events` | GET | 近期事件 |
| `/api/debug/snapshot` | POST | 儲存瀏覽器快照 |
| `/api/debug/ai-report` | GET | 整合瀏覽器 + 伺服器的除錯報告 |
| `/api/debug/reset` | POST | 重設除錯狀態 |
| `/api/debug/check` | GET | 檢查除錯流程狀態 |

### WebSocket
| 端點 | 說明 |
|------|------|
| `ws://host:port/ws` | 即時流量樣本推播 |

## 開發

```bash
# 執行測試
deno test

# 執行特定測試
deno test tests/collector_test.ts

# 格式化
deno fmt

# 型別檢查
deno check src/main.ts
```

## 版本管理

使用 [語意化版本控制](https://semver.org/)。版本自動遞增：

```bash
./scripts/bump-version.sh patch    # 0.2.0 → 0.2.1
./scripts/bump-version.sh minor    # 0.2.0 → 0.3.0
./scripts/bump-version.sh major    # 0.2.0 → 1.0.0
```

腳本會：
1. 更新 `deno.json` version 欄位
2. 建立 git 標籤 `vX.Y.Z`
3. 推送到遠端

### Git Hooks
`post-commit` hook 偵測自上次 tag 以來的 commits 並提示版本遞增。

## 除錯控制台

按 `F12` 或點擊 🐛 按鈕開啟除錯控制台。顯示：
- WebSocket 連線狀態
- Fetch 請求/回應記錄
- Console 訊息
- 瀏覽器狀態（DOM、圖表、全域變數、網路）
- AI 報告產生按鈕

## 授權

MIT
