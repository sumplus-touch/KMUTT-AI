module.exports = {
  apps: [{
    name: "kmutt-ai",
    script: "./node_modules/.bin/tsx",
    args: "server/index.ts",
    cwd: "/root/KMUTT-AI",
    env: {
      NODE_ENV: "production",
      // 3001 (the default) is held by the separate tiger-cowork instance
      // running out of /root/cowork, so this one takes 3030.
      PORT: 3030,
    },
    // Restart policy
    max_restarts: 50,
    min_uptime: "10s",
    restart_delay: 3000,
    // Auto-restart on file changes (server only)
    watch: false,
    // Logging
    error_file: "/root/.pm2/logs/kmutt-ai-error.log",
    out_file: "/root/.pm2/logs/kmutt-ai-out.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    // Memory limit — restart if exceeds 512MB
    max_memory_restart: "512M",
    // Graceful shutdown
    kill_timeout: 5000,
  }],
};
