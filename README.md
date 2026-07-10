# reline-bot

Docker-ready Telegram bot for DigitalOcean.

## Run locally

```bash
docker build -t reline-bot .
docker run --rm -p 3000:3000 --env-file .env reline-bot
```

## DigitalOcean App Platform

Set these environment variables:
- BOT_TOKEN
- PORT (optional, App Platform provides it)

The app listens on the port from `PORT` or `3000` by default.
