#!/bin/bash
# Start a desk that is already installed. Leave this window open.
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f package.json && -f ../package.json ]]; then
  cd ..
fi
if [[ ! -f package.json || ! -d node_modules ]]; then
  echo "The desk is not installed yet. Run: bash install-desk.sh"
  read -r -p "Press Enter to close."
  exit 1
fi

if [[ -x /opt/homebrew/bin/brew ]]; then
  export PATH="/opt/homebrew/bin:$PATH"
elif [[ -x /usr/local/bin/brew ]]; then
  export PATH="/usr/local/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Run: bash install-desk.sh"
  read -r -p "Press Enter to close."
  exit 1
fi

if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  open "http://127.0.0.1:8080/"
  echo "Strategy Desk is already running at http://127.0.0.1:8080"
  exit 0
fi

echo "Starting Strategy Desk. The page opens when the program is ready."
echo "Leave this window open. Closing it stops the desk."
echo "Orders are off after a restart until you turn them on."
(
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
      open "http://127.0.0.1:8080/"
      exit 0
    fi
    sleep 2
  done
) &
exec npm run dev
