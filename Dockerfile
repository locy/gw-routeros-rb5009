FROM denoland/deno:2.4.0
WORKDIR /app
COPY deno.json deno.lock* ./
RUN deno cache src/main.ts || true
COPY src ./src
COPY public ./public
ENV DATABASE_PATH=/data/monitor.sqlite3
EXPOSE 8080
CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "src/main.ts", "serve"]
