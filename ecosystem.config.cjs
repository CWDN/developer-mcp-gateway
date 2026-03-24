module.exports = {
  apps: [
    {
      name: "mcp-gateway",
      script: "npm",
      args: "start",
      cwd: __dirname,
      log_file: "logs/mcp-gateway.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 3099,
      },
    },
  ],
};
