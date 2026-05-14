#!/bin/bash
set -e

# Copy .env.example if .env doesn't exist
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[hype] Created .env from .env.example"
fi

# Install deps if needed
if [ ! -d backend/venv ]; then
  echo "[hype] Creating virtualenv…"
  python3 -m venv backend/venv
  backend/venv/bin/pip install -q -r backend/requirements.txt
  echo "[hype] Dependencies installed"
fi

echo "[hype] Starting server → http://localhost:8000"
cd backend && ../backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
