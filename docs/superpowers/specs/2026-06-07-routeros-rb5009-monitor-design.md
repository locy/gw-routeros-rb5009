# RouterOS RB5009 流量監控設計

日期：2026-06-07

## 目標

建立一套部署在 `gpu` server 的 RouterOS RB5009
流量監控系統，提供操作台優先的即時監控頁面與長期歷史圖表。Gateway 為 RouterOS
RB5009，可透過 `ssh GW` 連線；服務主機可透過 `ssh gpu` 部署。

第一版先交付穩定的 WAN/LAN 介面總流量即時與歷史監控。每設備 Top IP/MAC 排名保留
UI 與資料模型，等 RouterOS Traffic Flow 或替代統計來源經人工確認後再啟用。

## 已確認決策

- 監控範圍採 C：先做介面總流量，再擴充設備排名與歷史。
- RouterOS 設定採 C：所有會改 RouterOS 的設定先產生可審核腳本，不自動套用。
- 部署型態採 A：Docker Compose 跑在 `gpu`。
- 歷史保存採 1 年以上，近端細節較高、長期以彙總保存。
- 存取策略採 C：第一版只在內網開放，後續再加 Cloudflare Tunnel 或 reverse
  proxy。
- UI 版面採 A：操作台優先。
- 技術方案採 B：RouterOS API 加 optional SNMP/Traffic Flow。
- 實作語言改採 Deno/TypeScript；不使用 Python/FastAPI 作為第一版主技術棧。

## 架構

系統由四個主要元件組成：

1. `collector`
   - 定時連線 RouterOS API。
   - 讀取指定 WAN/LAN 介面的 byte counters、link 狀態、速率、錯誤計數。
   - 讀取 ARP 與 DHCP lease 建立 IP/MAC/hostname 對照表。
   - 第二階段接入 Traffic Flow 或替代統計來源，產生 Top IP/MAC。

2. `storage`
   - 第一版使用 SQLite。
   - 儲存 raw samples、彙總資料、設備對照表、事件與健康狀態。
   - Docker volume 保存資料庫檔案。

3. `web API`
   - 提供目前狀態、即時序列、歷史圖表、設備清單、事件與健康狀態 endpoint。
   - 前端只透過 API 讀資料，不直接連 RouterOS。

4. `dashboard`
   - 操作台優先版面。
   - 上方顯示 WAN/LAN 即時 Mbps、狀態與延遲。
   - 中間顯示 5 秒更新即時折線圖。
   - 下方顯示 Top IP/MAC 與最近尖峰事件。
   - 歷史圖表放在次層 tab 或獨立頁面。

第一版以單一 Deno/TypeScript service 實作上述元件。Deno service 內部拆成 focused
modules：設定、RouterOS client boundary、traffic math、SQLite
storage、collector、retention、HTTP/SSE API、RouterOS 腳本產生器。前端採原生
TypeScript、HTML、CSS 與輕量 SVG/canvas 圖表，避免第一版同時維護 Node/Vite/React
工具鏈。

## 資料流

第一階段資料流：

1. `collector` 每 5 秒透過 RouterOS API 讀取指定介面的 counters 與狀態。
2. `collector` 用相鄰兩次 counter 差值換算下載與上傳 bps。
3. 結果寫入 SQLite raw samples，並更新記憶體中的目前狀態快取。
4. `web API` 提供目前 Mbps、近 15 分鐘即時序列、今日累計與介面狀態。
5. `dashboard` 透過 SSE 或 WebSocket 接收即時更新；歷史頁透過 REST
   查詢不同時間範圍。

第二階段資料流：

1. `collector` 讀 RouterOS ARP/DHCP lease，維護 IP/MAC/hostname 對照。
2. 使用者人工確認並套用 RouterOS `.rsc` 腳本後，啟用 Traffic Flow
   或替代統計來源。
3. `collector` 寫入每設備流量資料表。
4. UI 顯示 Top IP/MAC、設備歷史與設備尖峰事件。
5. 如果設備流量來源尚未啟用，UI 顯示等待設定狀態，不影響介面總流量監控。

RouterOS 連線設定放在 `.env` 或 Docker secret，不提交密碼。

## 歷史保存與彙總

保存策略：

- 近 7 天保留 5 秒 raw samples。
- 近 90 天保留 1 分鐘彙總。
- 另建立 5 分鐘彙總，用於長時間圖表加速。
- 1 年以上保留 1 小時彙總。
- 長期保留每日總量，支援月用量、年趨勢與長期比較。

每日 retention job：

- raw samples 超過 7 天後刪除。
- 1 分鐘彙總超過 90 天後可刪除或降成 5 分鐘。
- 1 小時與每日彙總長期保留。
- 定期執行 SQLite `VACUUM`，避免資料庫檔案無限制膨脹。

備份策略：

- SQLite DB 放在 Docker volume。
- 提供 `scripts/backup-db.sh` 從 `gpu` 備份資料庫。
- 第一版不自動上雲，避免增加部署複雜度。

## 錯誤處理

- RouterOS 單次連線失敗不會中斷服務。
- 系統記錄最後成功時間、最後錯誤、連續失敗次數。
- dashboard 在資料延遲時顯示 stale 狀態。
- byte counter 變小時視為 RouterOS reboot、介面 reset 或 counter
  rollover，不計入負流量，並產生事件。
- 歷史圖表保留資料缺口，不補假資料。
- 如果 Top IP/MAC 來源未啟用，只停用該區塊，不影響核心監控。

## 安全邊界

- 第一版只綁定 `gpu` 內網 port，不公開到 Internet。
- RouterOS 使用獨立唯讀監控帳號。
- 所有會更動 RouterOS 的設定都先輸出 `.rsc` 腳本，使用者人工確認後才套用。
- `.env`、資料庫、備份檔不進 git。
- 第二階段公開存取前，需補登入驗證、HTTPS、來源限制與基本 rate limit。

## 告警

第一版只做頁面內狀態與事件列表，不做 Telegram 或
Email。資料模型預留告警規則，後續可加入：

- WAN down。
- RouterOS 連線中斷。
- collector 失聯。
- 流量異常尖峰。
- 月用量超過門檻。

## 第一版交付範圍

- Docker Compose 專案，可部署到 `gpu`。
- RouterOS 監控設定產生器，輸出可審核 `.rsc` 腳本。
- Collector 從 RouterOS API 讀介面流量與基本狀態。
- SQLite 儲存 raw samples 與彙總資料。
- 操作台優先 dashboard：
  - WAN/LAN 即時 Mbps。
  - 介面狀態與資料延遲。
  - 近 15 分鐘即時圖。
  - 今日與本月累計。
  - Top IP/MAC 區塊的等待狀態與資料模型。
  - 最近事件列表。
- 歷史頁：
  - 24h、7d、90d、1y、custom range。
  - 下載與上傳分開或合併顯示。
- 部署文件：
  - `gpu` 上 Docker Compose 啟動。
  - `.env` 範例。
  - RouterOS 腳本套用方式。
  - 備份與還原方式。

## 測試策略

- Collector counter 差值與 reset 處理單元測試。
- RouterOS API parser 與 mock fixture 測試。
- Retention 與 downsampling 單元測試。
- API endpoint 測試。
- 前端基本 render 測試。
- mock mode 驗證 dashboard 在沒有真 RouterOS 時仍能開啟。
- Deno 測試使用 `deno test`；格式與型別檢查使用 `deno fmt --check` 與
  `deno check`。

## 非目標

- 第一版不自動改 RouterOS 設定。
- 第一版不公開到 Internet。
- 第一版不加入 Telegram、Email 或其他外部告警。
- 第一版不要求 PostgreSQL 或 TimescaleDB。
- 第一版不引入 Python/FastAPI 或 Node/Vite/React 作為必要執行環境。
- 第一版不保證 Top IP/MAC 已有完整流量資料，除非使用者確認並套用第二階段
  RouterOS 統計來源。
