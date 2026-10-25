# Strategy Desk

Version 1.7.1. One desk. When Alpaca answers, the curve, blotter, and chart marks follow that account. A solid triangle is a fill. An open triangle is a valid signal that was not traded. Orders are sent by the desk process on this computer, as a limit for the last closed bar, and only while that process is armed. Dollars per buy at 0 spends Starting cash plus this symbol's later profit, not the rest of the Alpaca balance. A restart turns orders off. Do not leave a live account armed until paper has matched Alpaca across several sessions.

This is the tester copy. It fires no strategy until you load the unlock file you were sent. That file is not in this repository. Brokerage keys stay on your computer.

The user's guide, with the same install steps, is [public/strategy-desk-guide.pdf](public/strategy-desk-guide.pdf). How the strategies combine is [public/strategy-interplay.pdf](public/strategy-interplay.pdf). Opening an account and pasting keys is [public/broker-setup.pdf](public/broker-setup.pdf).

## Mac

Do not double-click a script, and do not run it from Downloads. Open **Terminal**, paste this, and press Return.

```bash
cd "$HOME" && curl -fsSL -o strategy-desk.zip "https://github.com/JPFava/strategy-desk/archive/refs/heads/main.zip" && unzip -o strategy-desk.zip && cd strategy-desk-main && bash install-desk.sh
```

That installs Node.js 22 or newer if needed, then opens the desk at `http://127.0.0.1:8080`. Leave the Terminal window open.

## Windows

1. Download https://github.com/JPFava/strategy-desk/archive/refs/heads/main.zip
2. Unzip it and open the folder `strategy-desk-main`.
3. Double-click `install-desk.bat`.

If Windows asks to approve Node.js, approve it, then double-click the file again. Leave the window open. The desk is at `http://127.0.0.1:8080`.

## Alpaca paper

The email and password on the first screen belong to this desk, not to Alpaca.

1. Open an account at https://alpaca.markets. The paper account is available before the live account is approved.
2. In the Alpaca dashboard, stay on paper and generate an API key. Copy the key and the secret. The secret is shown once.
3. On the desk, choose **Alpaca**, leave **Paper account** checked, and paste them into **API key** and **API secret**.
4. Press **Create this desk**.
5. Under **Strategies**, load the unlock file you were sent. Until you do, no strategy fires.
6. On the Alpaca panel, **Send this bar** sends the last closed bar once. **Turn orders on** lets the desk process keep checking until you turn it off, or the computer sleeps or restarts. The order is a limit. A fill is Alpaca's price. Nothing is sent while Alpaca says the market is closed, unless you allow that. Play money stays on its own tab.

Do not email the secret, and do not put it in a saved book.

## Going live later

Live orders are real money. The desk you install is the same one. What changes is the key.

1. In Alpaca, switch to the live account and generate a new key. It is a different pair from paper.
2. On the desk, press **Change brokerage**.
3. Choose **Alpaca**, uncheck **Paper account**, paste the live key and secret, and press **Save brokerage**.
4. On the Alpaca panel, load the live key file you were sent. Without that file the panel will not send.
5. Press **Send this bar** or **Turn orders on** only when you mean a real order. A restart turns orders off.

Check **Paper account** and paste the paper pair again to go back. Remove the live key when you are done with it.
