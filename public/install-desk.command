#!/bin/bash
# Double-click to install Node.js if needed, install the desk, and open it.
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f package.json && -f ../package.json ]]; then
  cd ..
fi
if [[ ! -f package.json ]]; then
  echo "This file has to sit in the Strategy Desk folder, next to package.json."
  echo "If you downloaded only this file, put it in that folder and double-click it again."
  read -r -p "Press Enter to close."
  exit 1
fi

if [[ -x /opt/homebrew/bin/brew ]]; then
  export PATH="/opt/homebrew/bin:$PATH"
elif [[ -x /usr/local/bin/brew ]]; then
  export PATH="/usr/local/bin:$PATH"
fi

node_major() {
  node -p "Number(process.versions.node.split('.')[0])"
}

if ! command -v node >/dev/null 2>&1 || [[ "$(node_major)" -lt 22 ]]; then
  if command -v node >/dev/null 2>&1; then
    echo "Node.js $(node_major) is too old. Strategy Desk needs 22 or newer."
  else
    echo "Node.js is not installed."
  fi
  if ! command -v brew >/dev/null 2>&1; then
    echo "Install Homebrew from https://brew.sh, or Node.js 22 from https://nodejs.org, then run this file again."
    read -r -p "Press Enter to close."
    exit 1
  fi
  echo "Installing Node.js..."
  brew install node
  hash -r
fi

if ! command -v node >/dev/null 2>&1 || [[ "$(node_major)" -lt 22 ]]; then
  echo "Node.js is still older than 22. Install a newer copy from https://nodejs.org and run this file again."
  read -r -p "Press Enter to close."
  exit 1
fi

echo "Node.js $(node_major) is ready."
echo "Installing desk packages..."
npm install
echo "Starting Strategy Desk at http://127.0.0.1:8080"
(sleep 2 && open "http://127.0.0.1:8080/") &
exec npm run dev
