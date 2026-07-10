module.exports = {
  apps: [
    {
      name: 'reline-bot',
      script: 'index.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      error_file: './bot.log',
      out_file: './bot.log',
      merge_logs: true,
    },
  ],
};
