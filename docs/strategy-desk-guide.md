# Strategy Desk

**Version 1.6.0.** Installation and user's guide. The same document ships with the app as a PDF. On the desk, the version next to the title opens it. **How the strategies work**, in the line under the title, is the companion: each strategy, and how they combine. **Saved books**, at the top of the strategy list, stores a named copy of the strategies and the play-money account in this browser. Recall loads that copy and recalculates. The symbol is left alone. Saving the same name replaces that book.

Strategy Desk is a research book. It replays one price tape through one cash account and records play-money fills. The Alpaca panel can also send that latest signal as a market order. Paper orders use the paper key. Live orders need a separate live key and are real money. The header switch stays off.

A tester's copy fires no strategy until an unlock file is loaded. That file is sent separately. It is not in the public project. The keys for a brokerage stay on the computer that typed them.

Times on the chart, the blotter, and the session rules are America/New_York.

## 1. Install and open

You need Node.js 22 or newer. The installer downloads it when it can.

### Mac

Do not double-click a script, and do not run it from Downloads. macOS blocks both. Open **Terminal**, paste this, and press Return.

```bash
cd "$HOME" && curl -fsSL -o strategy-desk.zip "https://github.com/JPFava/strategy-desk/archive/refs/heads/main.zip" && unzip -o strategy-desk.zip && cd strategy-desk-main && bash install-desk.sh
```

That downloads the desk into your home folder, where Terminal is allowed to run it. It installs Node.js 22 or newer if needed, then opens the desk at `http://127.0.0.1:8080`. Leave the Terminal window open.

### Windows

1. Download the project zip from https://github.com/JPFava/strategy-desk/archive/refs/heads/main.zip
2. Unzip it. Open the folder named `strategy-desk-main`.
3. Double-click `install-desk.bat`.

If Windows asks to approve Node.js, approve it, then double-click `install-desk.bat` again. The desk opens at `http://127.0.0.1:8080`. Leave that window open. Closing it stops the desk.

### Alpaca paper keys

The first screen is **Create this desk**. The email and password are for this computer only. They are not the Alpaca login.

1. Open a brokerage account at https://alpaca.markets. Paper trading does not wait for the live account to be approved.
2. In the Alpaca dashboard, stay on the paper account. Open its API keys and generate a key. Copy the key and the secret. The secret is shown once. If you lose it, generate a new pair.
3. On the desk, choose **Alpaca**. Leave **Paper account** checked.
4. Paste the paper key into **API key** and the paper secret into **API secret**.
5. Press **Create this desk**.

A paper key cannot place a live order. Do not paste the key into email, and do not put it in an unlock file or a saved book. Those files do not contain it.

### The unlock file

After you are signed in, open **Strategies** and load the unlock file you were sent. Until that file is loaded, no strategy fires. The file sets the book. You can change only the strategies it names. The rest stay locked.

### When you want live keys

Live orders are real money. They stay blocked until you load a live key file that was written for you. Saving live Alpaca keys is not enough.

1. In the Alpaca dashboard, switch to the live account and generate a live key. It is not the paper key.
2. On the desk, press **Change brokerage**.
3. Choose **Alpaca**. Uncheck **Paper account**.
4. Paste the live key and the live secret. Press **Save brokerage**.
5. On the Alpaca panel, load the live key file. Then **Send this signal** can reach the live account.

To go back, paste the paper pair, check **Paper account**, and save again. Remove the live key file if you do not want it stored on this computer.

### Sending a paper order

There is one desk. Paper and live are not two programs.

1. Load a market tape. A sample tape will not send.
2. Press **Recalculate** if the button is marked. The Alpaca panel uses the latest bar's play-money signal.
3. Press **Send this signal** once. A buy spends up to the dollars-per-buy figure, and not more than Alpaca cash. A sell closes the Alpaca position. The desk holds one position and does not sell short.
4. The order row shows Alpaca's status. A fill price is Alpaca's price, not the bar close.
5. **Send each new bar** waits for a newer bar. Leave the window open. It does not replay old bars.

If the market is closed, Alpaca can accept the order and fill it at the next open. The row stays on the panel until then.

Market bars are requested from Yahoo Finance for the regular session only (no pre-market, no after-hours). If that request fails, the desk loads a sample tape and says so. Sample numbers are not the market.

| Bar size | History requested |
| --- | --- |
| 1 minute | 5 days |
| 5 minute | 60 days |
| 15 minute | 60 days |
| 1 hour | 2 years |
| 1 day | 5 years |

The tape keeps at most the latest 20,000 bars. Duplicate timestamps collapse to the last copy.

## 2. One pass through the screen

1. **Symbol and bar size.** Press **Load** to fetch that tape. Changing either one loads again.
2. **Strategies.** Each card is one test. A side that is off is not in the combination. **AND** means the test has to pass with the other AND tests. **OR** means it can fire by itself.
3. **Account.** Starting cash, fees, dollars per buy, and how long a sale takes to become spendable cash.
4. **Recalculate.** Edits do not move the chart, the blotter, or the timing strips until you press this. The button is marked when the screen is ahead of the last calculation.
5. **Chart.** Candles, the lines that are switched on, and two timing strips locked to the same candles. Windows are 1D, 5D, 1M, and All. Drag to pan. Scroll to zoom.
6. **Candle read.** Select a candle. Every switched-on test reports Pass or Fail, with the numbers it used.
7. **Play money / Live book.** Play money is the only book that fills. Live book stays empty.
8. **Blotter.** One row per fill. Select a row to jump the chart to that candle.

Fills print at the **close** of the bar. The "vs close" column is therefore zero. Shares are whole shares. The book is long-only and holds one position: it buys only when flat, and it sells the whole position only when long.

## 3. How a trigger becomes a fill

On each bar the desk builds two lists, buy and sell, from the sides you switched on.

- Every **AND** test on that side must pass, **or** any **OR** test on that side must pass. Written as a sentence: [every AND] or [any OR].
- If a side has only AND tests, all of them must pass. If it has only OR tests, one pass is enough.
- A test that is not ready yet counts as a fail. An AND that is still warming up blocks that side.
- If the combination passes, the names of the AND tests (all of them) and the OR tests that passed are written on the fill.
- A side with nothing switched on never fires.
- Drop hold is not in either list. It cannot cause a buy or a sell. It can only refuse a sell. See section 8.

Then the cash book decides:

| Book state | What can fill |
| --- | --- |
| Flat | A buy, if settled cash can pay for at least one share after fees. A sell is skipped because the book was flat. |
| Long | A sell, unless drop hold is blocking it. A buy is skipped because the book was already long. |

A skipped signal is counted. It is not a fill. The skip reasons are: book was already long, book was flat, sell hold is on, settled cash cannot buy a share.

## 4. The starter book

This is what a fresh desk calculates. Every side that is on is AND.

**Buy, all of these:**

- Close at or under 102% of the lower band (within 2% above the band, or through it).
- RSI(7) at or under 30.
- Middle-band slope at least −1% over 5 bars.
- Volume at least 1.5× its 20-bar average.
- Money Flow Index(7) at or under 50.
- Session VWAP inside the candle (low to high).

**Sell, all of these:**

- Close at or over 98% of the upper band (within 2% under the band, or through it).
- RSI(7) at or over 60.
- Close at or over session VWAP.

**Also on, but not a vote:** a session low 10% under the prior session close blocks sells until the close has recovered halfway from that trough back toward the prior close. Any buy that session turns the hold off for the rest of the session.

**Off until you switch them on:** last fill, the three hourly EMAs, the three EMA relations, and both trend tests.

**Account:** $25,000 starting cash, no fees, dollars per buy = 0 (use all settled cash), sale proceeds spendable after 1 day, and confirmed-sale-proceeds off unless you turn that switch on. With the delay at 1 day and that switch off, sale cash cannot fund a buy until a day of bar-time has passed. Cash that was never spent can still buy during the wait.

## 5. Shared indicators

These are calculated once. The strategy cards only decide which comparison is allowed to vote.

### Bollinger bands

One middle line, one upper line, one lower line. Length and width are not themselves a buy or a sell.

- Middle = simple average of the last `length` closes. The starter uses 30.
- Width is a multiplier on the standard deviation of those same closes. The starter uses 2.
- The standard deviation is the **sample** form: divide the sum of squared deviations by `length − 1`, then take the square root. That matches the Band Desk upper band. It is a little wider than a population deviation.
- Upper = middle + width × deviation. Lower = middle − width × deviation.
- The lines appear after `length` closes exist. Before that, any band test fails.

The chart draws the middle in paper and the two bands in a lighter paper when any band test is on.

### Session VWAP

Volume-weighted average price for the current Eastern-time session. It resets at the first bar of each new date.

Typical price of a bar is `(high + low + close) / 3`. VWAP is the running sum of typical price × volume, divided by the running sum of volume. A bar with no volume does not move the sums. If volume so far is zero, VWAP is that bar's typical price.

VWAP is bronze on the chart when either VWAP test is on.

### Hourly EMAs

Three independent averages. The starter lengths are 20, 50, and 100 **clock hours**, not trading days and not bars.

- Bars are grouped by the Eastern clock hour.
- The close used for an hour is the last close printed in that hour.
- The hour that is still forming is included as a provisional point. It is committed only when the next hour starts.
- The average is seeded with a simple average of the first `hours` hourly closes, then continues as an exponential average with smoothing `2 / (hours + 1)`.
- On a daily tape there is no hourly close. A switched-on hourly EMA fails every bar and, if it is AND, blocks every fill. The desk warns you. Turn that side off.

### Trend line

A straight line fitted by least squares to the closes of the last window. The starter window is 4 hours.

The window length in bars is `round(hours × 3,600,000 / bar length)`. On 5-minute bars a 4-hour window is 48 bars. The fit needs at least 3 bars. On a daily tape the window is shorter than 3 bars, so both trend tests fail and block if left on.

The line value on the current bar is the fitted value at the right edge of the window. The slope, in percent, is how far that right edge has moved from the left edge, relative to the left edge:

`slope % = (right − left) / |left| × 100`

It is the move across that window, not an annualized rate.

## 6. Each strategy, and how it votes

A card has a buy switch and a sell switch, except drop hold, which only has a sell switch. Each side has its own AND/OR, and where a threshold gates both sides it has its own number. The master matrix, further down, replaces those AND/OR switches with rows.

A fail on an AND side blocks that side. A fail on an OR side only means that OR rule does not fire. Other OR rules, or a fully passing AND group, can still fill. That simple form is `(A and B and C) or D`. It cannot say `(A and B) or (A and C)`. The matrix can.

### Master matrix

Turn on **Use rows** for the buy side, the sell side, or both. Columns are the rules whose switch is on for that side. Drop hold is not a column.

Each row is one AND. A mark puts that rule in the product. A blank cell is a don't-care: that rule is not required for the row. The rows are ORed. If any row is high, that side fires. A row with no marks stays low. No rows, with the matrix on, fills nothing.

`A and B`, or `A and C`, or `B and D` is three rows. The timing strip then shows one lane per row. The ALL tick is the OR of those lanes. The AND/OR switches on the cards are ignored on a side whose matrix is on.

### Lower band

**What it is.** The close compared with the lower Bollinger band.

**Trigger.** Passes when

`close ≤ lower band × (percent / 100)`

The buy percent and the sell percent are separate. Both start at **102**. The starter enables the buy only.

### Upper band

**What it is.** The close compared with the upper Bollinger band.

**Trigger.** Passes when

`close ≥ upper band × (percent / 100)`

The buy percent and the sell percent are separate. Both start at **98**. The starter enables the sell only.

### Band slope

**What it is.** The percent change of the **middle** band, not the close and not the width.

`slope % = (middle now − middle N bars ago) / middle N bars ago × 100`

Starter: buy floor **−1**, sell floor **+1**, over **5** bars. The slope is not ready until the middle band exists both now and 5 bars ago.

**Buy trigger.** Slope ≥ buy floor. At −1, a flat or rising middle passes, and a middle that has fallen less than 1% also passes.

**Sell trigger.** Slope ≤ sell floor. At +1, the sell passes when the middle is up less than 1%, flat, or falling. The sell floor is not the negative of the buy floor unless you set it that way.

The starter enables the buy only.

### Volume

**What it is.** This bar's volume divided by the simple average of the last `length` volumes, including this bar. Starter length is 20.

**Trigger.** Each side has its own multiple:

`volume / average ≥ multiple`

Both start at **1.5**. The length of the average is shared. A bar at 1.50× passes that side. Volume does not care whether the bar is up or down.

### RSI

**What it is.** Wilder's Relative Strength Index on closes.

1. Change = this close − previous close.
2. The first RSI, printed on bar number `length`, uses the simple average gain and average loss of the first `length` changes.
3. After that, each bar updates Wilder's way: `average = (previous average × (length − 1) + this bar) / length`.
4. `RSI = 100 − 100 / (1 + average gain / average loss)`. If both averages are 0, RSI is 50. If average loss is 0, RSI is 100.

Starter length is **7**. It is ready on bar 7 (counting from 0, the eighth bar).

**Buy trigger.** RSI ≤ buy level. Starter **30**. This is the oversold side: the desk buys weakness, not a cross back up through 30.

**Sell trigger.** RSI ≥ sell level. Starter **60**. This is strength, not the textbook 70. A reading of 70.5 passes. A reading of 59.9 fails.

The starter uses both sides.

### Relative trend

**What it is.** The Relative Trend Index. It asks where the close sits inside a band around its own average. That one number carries both the direction and the strength.

1. Middle = the average close over `length` bars. Starter **30**.
2. Half-width = `width` × the sample standard deviation of those closes. Starter width **2**, the same sample deviation the Bollinger bands use.
3. Raw reading = `100 × (close − (middle − half-width)) / (2 × half-width)`. The middle of the band is 50. The upper band is 100. The lower band is 0. A close outside the band prints past 0 or past 100. A band with no width prints 50.
4. The plotted value is an exponential average of that raw reading. Starter smooth **3**. A smooth of 1 leaves the raw reading unchanged.

**Direction.** Above 50 is up. Below 50 is down. The buy passes when the reading is at or above the up line. The sell passes when it is at or below the down line. Both lines start at **50**, and both sides start off.

**Strength.** How far the reading is from 50. The buy floor and the sell floor are separate. Both start at **10**: the buy needs at least 60, and the sell needs 40 or less. A floor of 0 is the same test as the 50 line. Strength starts off.

Direction and strength are separate votes. Turn both on and set them to AND when a buy should be up and strong, not merely a hair above 50. They do not replace the 4-hour line. The line is the close versus a fitted path. This index is the close versus a volatility band.

**Negative.** Passes while the reading is below zero. Zero is the lower edge of the band, so this is a close through that edge. A reading of exactly zero does not pass. Both sides start off, and either side can use the same test. The vote stays true on every negative bar, not only the bar it crosses.

**Reversal.** Isolates a valley or a peak in the reading. **Periods** is the window, and it starts at **6**. The buy is the valley. The sell is the peak. Both start off.

Over that many readings, the low or the high has to sit inside the window. It cannot be the newest bar, and it cannot be only the oldest bar. A valley passes while the newest reading is back above that interior low. A peak passes while the newest reading is back under that interior high. A straight rise or a straight fall does not pass. A longer window skips the small turns. The vote stays true while that extreme is still inside the window and the reading has not returned to it. When the extreme ages out of the window, or a new extreme prints on the newest bar, the vote goes low.

**Buy below.** Buy when the reading is at or under a level. The level starts at **1**, and the buy starts off. The level may be negative. A level of 0 passes on zero and on every negative reading. A level of 1 also passes a reading that is only at the lower edge of the band. A reading of exactly 1 passes. There is no sell on this test. Raise the level if you want a milder dip. Use **Negative** when zero itself should fail.

**Its own line.** A slower exponential average of the same reading. Starter length **10**. Both sides start off. A side passes when any checked test on this card passes.

**Versus the line** starts checked. The buy passes while the reading is above the line. The sell passes while it is under the line. Equal does not pass.

**Trend** starts off. The buy passes while the line is rising. The sell passes while the line is falling. A flat line passes neither side.

**Above or below a value** starts off. The buy passes when the reading is at or above the buy value. The sell passes when it is at or under the sell value. Both values start at **50**.

The vote stays true while a checked test remains true, not only on the bar it first passes. This line is not the 4-hour price trend line. That line is in dollars. This reading is not, so the two are never compared.

The lower chart draws a bronze line at 0. Its scale starts at 0 to 100 and stretches, above or below, when a turned-on reading leaves that range. 0, 50, and 100 stay marked.

### Money flow

**What it is.** The Money Flow Index. It is RSI's volume-weighted cousin, on a rolling window rather than Wilder smoothing.

1. Typical price = `(high + low + close) / 3`.
2. Raw flow = typical price × volume.
3. If typical price rose versus the previous bar, the raw flow is positive. If it fell, the raw flow is negative. If it was unchanged, the bar adds nothing.
4. Over the last `length` bars, `MFI = 100 − 100 / (1 + positive sum / negative sum)`. Both sums zero → 50. Negative sum zero → 100.

Starter length is **7**, buy level **50**, sell level **80**.

**Buy trigger.** MFI ≤ 50. Money is not flowing in. The starter requires this on the buy, together with the lower band, so a dip without selling pressure in the flow does not qualify, and a dip that is only price (MFI still above 50) does not qualify either.

**Sell trigger.** MFI ≥ 80. The starter leaves the sell off. Turning it on adds "money is flowing in hard" as a sell condition.

### VWAP in the candle

**What it is.** Whether the session VWAP sits inside this candle.

**Trigger.** The same test on either side:

`low ≤ VWAP ≤ high`

A wick through VWAP passes even if the close is far from it. A candle entirely above or entirely below VWAP fails. The starter requires this on the buy: the lower-band test and a VWAP tag have to land on the same 5-minute bar.

### Close versus VWAP

**What it is.** Where the close finished relative to session VWAP. This is a different card from "VWAP in the candle." You can run either, both, or neither.

**Buy trigger.** `close ≤ VWAP`.

**Sell trigger.** `close ≥ VWAP`.

The starter enables only the sell. A sell then needs the upper-band test, RSI extended, **and** a close that finished on or above the session VWAP. Being above VWAP is not the same as VWAP sitting inside the candle.

### Hourly EMA, each length

**What it is.** The close compared with that hour-length exponential average. See section 5 for how the average is built. You can change the hour count on the card. The chart legend uses the hour count you set.

**Buy trigger.** `close ≥ EMA`.

**Sell trigger.** `close ≤ EMA`.

These fight the starter book if you turn them on beside it. The starter buy wants a close down at the lower band. "Close above the 20-hour average" will often be false on that same bar, and an AND join will block the buy. Leave a side off when it fights a test you already require. All three start off.

Until enough hours exist, the test fails. If it is AND, it blocks every fill on that side. The desk prints a warning with the hours on the tape.

### EMA relations A, B, and C

**What they are.** Three slots that compare the close and the three hourly averages with each other. They do not calculate a new average. They fail until every average they name is ready.

Each slot is one of three operations. The card lists the lines from the one you put first to the one you put last. Name them Close, and the fast, mid, and slow averages (the 20-hour, 50-hour, and 100-hour lines, or whatever hours you set).

**Rank.** The lines must sit in the order you listed, each strictly above the next. Equal values fail. A buy list of fast, mid, slow passes only when fast > mid > slow. **Sell reverses** (on by default) flips that list for the sell, so the same slot sells when slow > mid > fast. Turn sell-reverses off if the sell should use the same order as the buy.

**Touch.** The highest and lowest of the chosen lines must be within the tolerance. Tolerance is either a percent of the close or a dollar amount. If you pick a single average and you do not also pick Close, the test is close-versus-that-average within the tolerance. Starter tolerance is 0.25%.

**Gap.** The same spread, tested the other way. **At least** (wide) passes when the spread is ≥ the gap. **At most** (tight) passes when the spread is ≤ the gap. Starter gap is 1%. A single average without Close again means close versus that average.

A rank slot with fewer than two lines fails and blocks that side while it is AND. Touch and gap with no average do the same.

All three slots start off. A is a rank of fast above mid above slow. B is a touch of those three. C is a wide gap between fast and slow.

### Trend slope

**What it is.** The percent slope of the fitted trend line, from section 5.

**Buy trigger.** Slope ≥ buy floor. Both floors start at 0, so a rising fit passes the buy and a flat or falling fit passes the sell.

**Sell trigger.** Slope ≤ sell floor. The sell floor is the slope itself, not the negative of the buy floor.

Starts off. On a daily tape it cannot pass.

### Trend line

**What it is.** The close compared with the fitted line on this bar.

**Buy trigger.** `close ≥ line`.

**Sell trigger.** `close ≤ line`.

Starts off. Independent of the slope test: you can require a rising fit, a close above the line, both, or neither.

### Last fill

**What it is.** A dollar step away from the last play-money fill of the opposite side. It does not look at the market's previous trade. It looks at this book's own fills. The chart can draw the step as a horizontal level.

**Sell trigger.** Once this book has a buy, the close must be at least `dollars above last buy` over that buy price. Starter is $1: `close ≥ last buy + 1`. With **Sell when the close is under the last buy** on, the same sell also passes when the close is under the last buy by `dollars under the last buy`. Zero means any close under the fill. A close equal to the buy does not sell. Either condition is enough. The starter leaves this stop off.

**Buy trigger.** Once this book has a sell, the close must be at least `dollars below last sell` under that sell price. Starter is $1: `close ≤ last sell − 1`. **Buy whenever the book is flat** ignores that dollar step and passes on every bar. The book still buys only when it is flat. The starter leaves this off.

Until the book has sold once, the dollar buy step is **waiting**. It is not a fail, and it is not in the combination, so the first entry can come from the flat buy or the other buy tests. Until the book has bought once, the sell step waits the same way. On the timing strip a wait is a dashed mid-line and is labeled out of the test.

After that, a failing AND step blocks its side unless an OR rule passes. A passing OR step can fire even when the AND group fails.

Starts off.

## 7. AND, OR, and the timing strips

The strips sit under the candles and use the same horizontal scale. One strip is every buy rule that is on. The other is every sell rule that is on, plus Not Held when drop hold is on.

| Mark | Meaning |
| --- | --- |
| High | The test is true on this bar. |
| Low | The test is false. |
| Dashed mid-line | Waiting, and not in the combination. Used by last fill before this book has a fill to measure from. |
| ALL tick | That side's combination is true: every AND, or any OR. An ALL tick is not a fill. The book can still skip it for cash, for already being long or flat, or for a sell hold. |

The right-hand caption of a strip lists each rule with 1 or 0 and its AND or OR, then ALL.

**Not Held** is status, not a vote. It is drawn on the sell strip so the true/false sense matches the other rows:

- High means the sale is free. Drop hold is not blocking.
- Low means the sale is held. A sell signal on that bar is skipped with "sell hold is on."
- Not Held is not part of ALL. A high ALL tick can still sit on a low Not Held bar. That bar does not sell.

The price chart shades the bars where a sale is held, and it draws the prior close and the recovery price while the hold is on. Shade marks the block. The Not Held row is the inverse of that shade.

## 8. Drop hold

Drop hold never buys and never sells. With the switch off, Not Held stays high and nothing is shaded.

With the switch on, each Eastern session is judged against the **prior session's last close**, not against today's high.

1. At the first bar of a session, hold, breach, and disarm all clear.
2. The line is `prior close × (1 − drop% / 100)`. At 10%, a prior close of 151.57 puts the line at 136.41.
3. The first time this session's low touches or trades through that line, the session has breached. If no buy has filled yet today, the hold latches. The anchor is the prior close. The trough is that bar's low.
4. While the hold is on, the trough follows any lower low. The recovery price is

   `trough + (recover% / 100) × (prior close − trough)`

   At 50%, that is halfway from the worst low back to the prior close.
5. The hold ends when the **close** prints at or above the recovery price. It does not end just because a wick tags it.
6. **A buy disarms the session.** If the hold was already on, that buy cancels it on the same bar (the buy still fills — hold does not block buys) and Not Held goes high. If the buy happened before the breach, a later breach does not start a new hold. Either way the hold stays off for the rest of that session, even if price keeps falling.
7. The next session starts clean. A disarm does not carry overnight.

The candle read says **Not held** or **Held**, with the prior close, the distance of the session low from that close, and the recovery price when one exists.

Worked example. Prior close 100, drop 10%, recover 50%. The line is 90. The session low trades 88, so the hold latches, trough 88. Recovery is 88 + 0.5 × (100 − 88) = 94. Sells are blocked until a close at or above 94. If a buy fills at 89 before that, the hold cancels and a later print of 80 does not block the afternoon.

## 9. The account

| Field | Starter | Effect |
| --- | --- | --- |
| Starting cash | 25,000 | Equity at bar zero, before any fill. |
| Flat fee | 0 | Dollars charged on every buy and every sell. |
| Percent fee | 0 | Percent of the gross, charged on every buy and every sell. |
| Dollars per buy | 0 | 0 means spend all settled cash. Any other number is a cap, still limited by settled cash. |
| Delay | 1 day | How long sale proceeds stay unsellable-as-cash, measured from the bar's timestamp. Choices: instant, 15 minutes, 1 hour, 1 day, 2 days. |
| Use confirmed sale proceeds | off | On, or delay = instant: sale cash is settled immediately. Off, and delay is not instant: proceeds sit unsettled until the delay elapses. |
| From / To | empty | Inclusive Eastern session dates. Empty runs the whole tape. The book does not fill outside the window, and the return is marked at the last bar inside it. Indicators still use bars before From, so a short window is not a cold start. Press Recalculate after changing the dates. |

Share count on a buy is

`floor( (budget − flat fee) / (price × (1 + percent fee / 100)) )`

The buy is skipped if that is under 1 share, or if the cost including fees is more than settled cash. Unsettled sale proceeds are not part of buying power. Cash that was never tied up in the sale still is.

A sell closes the whole position. Fee is the flat fee plus the percent of gross proceeds. Net proceeds are gross minus fee. If the fee is larger than the gross, cash is reduced and does not go below zero.

Equity after a bar is settled cash + unsettled proceeds + shares × close. The return is that ending equity against starting cash. Max drawdown is the worst peak-to-trough fall of that equity, in percent.

**Buy and hold**, shown next to the strategy return, buys as many shares as the starting cash can afford on the first bar, pays the same fees, and holds to the last close. It ignores the delay, because it never sells. Difference is strategy return minus that buy-and-hold return.

Round trips count completed sells. An open position at the end of the tape is still marked to the last close inside equity, and it is not yet a round trip.

## 10. Reading a bar when a fill surprises you

Select the candle. Read the sell or buy list top to bottom.

1. A side that says **off** is not in the test.
2. **Fail** on an AND rule is enough to refuse the combination, unless some OR rule on that same side passed.
3. **Wait** means the rule is not voting yet.
4. **Pass** on every AND rule, or on one OR rule, produces an ALL tick.
5. If ALL is true and there is still no fill, the book refused it. The skip line under the statistics names the reason: already long, still flat, sell hold is on, or not enough settled cash.
6. If the sale was the question, read **Not Held**. Low means drop hold blocked it. The detail gives the prior close and the recovery price. High means the hold was not the reason.

Changing a number, a switch, or AND/OR does nothing to those answers until you press **Recalculate**.

## 11. What this desk will not do

- It will not send a live order. The Live switch and the Live book are reserved and empty.
- It will not hold two positions, sell short, or buy more while already long.
- It will not fill inside the bar. The price is the close.
- It will not invent partial shares.
- It will not keep sale cash spendable during the delay unless you turn on confirmed sale proceeds or set the delay to instant.
- It will not treat pre-market or after-hours prints as bars. The tape is the regular session.
- It will not use the session high as the drop-hold anchor. The anchor is the prior session close.
