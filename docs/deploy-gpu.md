# gpu 部署

1. 將 repository 放到 `gpu`。
2. 複製 `.env.example` 為 `.env`。
3. 填入 RouterOS host、監控帳號、密碼、WAN/LAN interface 名稱。
4. 執行 `docker compose up -d --build`。
5. 在內網開啟 `http://<gpu-ip>:8080`。
6. 查看 log：`docker compose logs -f monitor`。
