# 備份與還原

備份：

```bash
scripts/backup-db.sh
```

還原：

1. 停止服務：`docker compose down`。
2. 將備份檔複製回 Docker volume 中的 `/data/monitor.sqlite3`。
3. 啟動服務：`docker compose up -d`。
