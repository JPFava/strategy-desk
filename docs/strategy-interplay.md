# How the strategies work

Strategy Desk 1.7.0. This is the companion to the user's guide. The guide covers installation, the account, and the formulas. This document says what each strategy is for, and how the ones you turn on act on each other.

A high signal in play money is not an order. An order is sent only from the Alpaca panel, by the desk process, and only for the side the real position allows.

## Saved books

**Saved books** is at the top of the strategy list. Type a name and press **Save**. That stores the strategies, including the matrix, and the play-money account. It does not store the symbol. Press **Recall** to put that book back on the desk and recalculate. **Remove** deletes the name. Saving a name that already exists replaces it. The list holds 24 books, in this browser only.

## 1. A true test is not a fill

Every card is one test. Most cards have a buy side and a sell side. Each side is either true or false on the bar you are looking at.

A side fires only when its combination says so. Section 2 is that combination. A fired side still does not fill unless the book allows it.

- A buy fills only when the account is flat, settled cash can buy at least one whole share, and the bar is inside the date range.
- A sell fills only when the account is long and the sale is not held.
- The fill price is that bar's close.
- The book is long-only. It never sells short, and it never holds two positions.

Press **Recalculate** after you change a switch, a number, or a matrix row. The chart stays on the last calculation until you do.

A rule you leave off is not in the test. It cannot block a fill and it cannot cause one.

## 2. How turned-on rules combine

There are two combiners. Use one of them on a side. If **Use rows** is on for that side, the AND/OR switches on the cards are ignored.

### The switches: one AND group, plus loose ORs

Each side's switch is AND or OR.

- Every AND rule must pass.
- Any one OR rule may pass on its own.
- Together that is `(A and B and C) or D or E`.

Say the buy side has the lower band and RSI set to AND, and volume set to OR.

| Lower band | RSI | Volume | Buy fires? |
| --- | --- | --- | --- |
| Pass | Pass | Fail | Yes. Both AND rules passed. |
| Pass | Fail | Pass | Yes. Volume passed as OR, so the failed RSI does not block. |
| Pass | Fail | Fail | No. |
| Fail | Pass | Fail | No. |

An OR rule that fails does nothing. It does not block the AND group.

This form cannot say "lower band and RSI, or lower band and money flow." A rule sits in only one place: the AND group, or the OR list. For two different products, use the matrix.

### The matrix: each row is an AND, the rows are ORed

Turn on **Use rows** for buys, for sells, or for both. Columns are the rules whose switch is already on. A mark puts that rule in the row. A blank cell is ignored on that row. It does not have to pass.

A row fires when every marked rule passes. The side fires when any row fires. A row with no marks stays low. No rows, with the matrix on, fills nothing.

`A and B`, or `A and C`, or `B and D` is three rows:

| Row | A | B | C | D | Fires when |
| --- | --- | --- | --- | --- | --- |
| G1 | marked | marked | | | A and B both pass |
| G2 | marked | | marked | | A and C both pass |
| G3 | | marked | | marked | B and D both pass |

On a bar where A and C pass and B fails, G2 is high and the side fires. G1 and G3 stay low. A bar where only B passes fires nothing, because no row is B alone.

The timing strip then draws one lane per row. The ALL tick is high when any row is high.

Drop hold is not a column. It can still block a sale. See section 4.

### Waiting is not a failure

Last fill has nothing to measure until this book has a fill on the other side. Until then that side is waiting. A waiting rule is left out of the combination. It does not fail the AND group, and a matrix row that needs it stays low. On the timing strip a wait is a dashed mid-line.

### A rule that is not ready does fail

Bollinger bands, RSI, money flow, the hourly averages, and the trend line all need a warm-up. Until they exist, the test is false. If that rule is AND, or it is marked in a matrix row, the row does not fire. Leave a long average off until the tape has enough hours. The desk warns you when a trend test is on and the tape cannot support it.

## 3. The strategies

Starter numbers are the SOXL 5-minute book the desk opens with. "Starts off" means that side is not in the starter book.

### Lower band

**Idea.** Price is down at the bottom of its recent range.

**Buy.** The close is at or under the buy percent of the lower Bollinger band. Starter **102**: the close may be up to 2% above the band, or anywhere below it. A close of 100 against a lower band of 98.04 passes, because 102% of 98.04 is about 100.00. A close of 101 does not.

**Sell.** The same comparison, with its own percent. The starter leaves the sell off. A lower-band sell means "still pressed against the floor," which is an odd reason to exit a long. Most books use the upper band for that.

**With others.** This is a location test. It does not know whether the dip is busy, washed out, or inside a downtrend. Pair it with volume, RSI, or money flow if you want the dip to mean something, and with the trend line if you only want dips that happen above a rising path.

### Upper band

**Idea.** Price is up at the top of its recent range.

**Sell.** The close is at or over the sell percent of the upper band. Starter **98**: the close may sit 2% under the band, or anywhere above it. A close of 129 against an upper band of 128.43 is still under the raw band, and it still passes, because 98% of 128.43 is about 125.86.

**Buy.** Its own percent, same comparison. The starter leaves the buy off. Buying the upper band is buying strength, the opposite of the starter dip.

**With others.** On its own it sells every stretch, including a stretch that is the start of a larger move. RSI at or over 60, or a close at or above VWAP, asks the stretch to be confirmed. A stop on the last-fill card can get you out earlier if the stretch never comes.

### Band slope

**Idea.** The middle of the Bollinger band is rising or falling. This is the band's center, not the close, and not the width.

Over the slope bars (starter **5**), slope percent is the change in the middle divided by the middle.

**Buy.** Slope is at least the buy floor. Starter **−1%**. A flat middle passes. A middle that has fallen less than 1% passes. A middle that has fallen more than 1% fails. The starter uses this so a lower-band touch in a collapsing band does not buy.

**Sell.** Slope is at or under the sell floor. Starter **+1%**. The sell passes when the middle is up less than 1%, flat, or falling. The sell floor is not the negative of the buy floor unless you type it that way. The starter leaves the sell off.

**With others.** A floor of −1 is a loose gate, not a trend system. If you want "only buy rising markets," use the 4-hour trend line. The band slope is a short look at the same window the bands use.

### Volume

**Idea.** This bar was busy compared with recent bars.

Volume divided by its average must be at least the multiple. The average length is shared (starter **20**). The buy multiple and the sell multiple are separate. Both start at **1.5**. A bar at 1.50 times passes. A bar at 0.66 times fails. Up or down does not matter.

**With others.** Volume is a filter, not a reason. AND it with a band or an oscillator so a quiet touch does not count. OR it, and a busy bar buys even when the band test fails, which is rarely what you want. The starter ANDs 1.5 times into the buy.

### RSI

**Idea.** Recent closes have been weak, or they have been strong. Wilder's RSI, starter length **7**.

**Buy.** RSI is at or under the buy level. Starter **30**. The desk buys the weak reading itself. It does not wait for RSI to cross back up through 30.

**Sell.** RSI is at or over the sell level. Starter **60**, not the textbook 70. A reading of 70.5 passes. A reading of 59.9 fails.

**With others.** RSI 30 and a lower band often arrive together, but not always. AND them when you want both. On the starter sell, RSI 60 and the upper band have to agree, so a high RSI in the middle of the range does not sell, and a tag of the upper band with RSI still at 45 does not sell either.

### Money flow

**Idea.** Like RSI, but the bars are weighted by volume. A down bar on heavy volume pulls it down. A quiet down bar does not. Starter length **7**.

**Buy.** Money flow is at or under the buy level. Starter **50**: money is not flowing in. The robust book uses **30**, a deeper dip.

**Sell.** Money flow is at or over the sell level. Starter **80**, and that side starts off. The robust book leaves it off on purpose, so the exit is the dollar target or the stop, not a hot money-flow reading.

**With others.** On a fast tape, money flow of length 7 swings several points a bar. AND it with a slower gate, such as the 4-hour line, if you do not want every noisy dip. Leave it as the only buy, with an OR or a matrix row of one, if you do want those dips.

### RTI direction

**Idea.** Where the close sits inside a band around its own average. The middle of that band is 50. Above 50 is up. Below 50 is down. Starter length **30**, width **2**, smooth **3**. This card starts off.

**Buy.** The reading is at or above the up line. The up line starts at **50**.

**Sell.** The reading is at or below the down line. The down line starts at **50**.

**With others.** Direction alone is true for almost any bar that is merely on one side of neutral. AND it with RTI strength when "up" must also mean "not a hair above 50." Do not confuse this line with the 4-hour trend line. That line is a price. This reading is not, so the two are never compared with each other.

### RTI strength

**Idea.** How far the same reading is from 50. This is a second vote, not a second calculation. It starts off.

**Buy.** The reading is at least the buy floor above 50. A floor of **10** needs a reading of 60 or more.

**Sell.** The reading is at least the sell floor below 50. A floor of **10** needs a reading of 40 or less.

**With others.** Direction AND strength is "up and strong" or, on the sell, "down and strong." Strength OR direction is almost the same as direction, because a strong reading is already on one side of 50. Use AND.

### RTI negative

**Idea.** The close is through the lower edge of the RTI band. The reading is below zero. Exactly zero does not pass. Both sides start off. There is no number to set.

**Buy and sell.** The same test. It stays true for every bar the reading remains negative, not only the bar it crosses.

**With others.** This is stricter than RTI below at 0, because a reading of zero fails here and passes there. AND it with a valley when you want the turn up to happen while the reading is still negative. OR it with RTI below if either kind of washout should count.

### RTI reversal

**Idea.** A valley or a peak in the RTI reading, isolated inside a window. **Periods** starts at **6**. Both sides start off. The buy is the valley. The sell is the peak.

**Buy.** The lowest reading in the window sits inside it, not on the newest bar and not only on the oldest, and the newest reading is back above that low.

**Sell.** The highest reading in the window sits inside it, and the newest reading is back under that high.

A straight rise or a straight fall does not pass. The vote stays true while that extreme is still inside the window and the reading has not returned to it. A longer window skips the small turns.

**With others.** A valley AND RTI negative buys the turn up only while the reading is still below zero. A valley alone also buys turns that happen above zero. A peak OR the RTI line sells on either the isolated high or a break of the line. One matrix row with both cells marked waits for the peak and the line break on the same bar.

### RTI below

**Idea.** The reading is washed out, near or through the bottom of its band. Buy only. There is no sell on this card. It starts off. The level starts at **1**, the lower edge of the band. The level may be negative.

**Buy.** The reading is at or under the level. A reading of exactly 1 passes. A level of 0 also passes a reading of zero. Raise the level if you want a milder dip. Use RTI negative when a reading of zero should fail.

**With others.** This is the buy for "the averages are stacked and the market is exhausted." Put the EMA touch in the same AND, or in the same matrix row, as this card. It will not fire often at a level of 1. That is the point.

### RTI line

**Idea.** The reading compared with a slower average of itself, or with the direction of that average, or with a number. Starter length of that average is **10**. Both sides start off. A side passes when any checked test on the card passes.

**Versus the line** starts checked. The buy passes while the reading is above its line. The sell passes while it is below. Equal does not pass.

**Trend** starts off. The buy passes while the line is rising. The sell passes while it is falling.

**Above or below a value** starts off. The buy passes at or above the buy value. The sell passes at or under the sell value. Both start at **50**.

The vote stays true for every bar a checked test remains true. It is not only the crossing bar.

**With others.** "Sell when RTI goes under its line" is this card, sell on, and no other sell rule. If you AND it with the upper band, you will only sell that break when price is also stretched, which fights the idea. If you OR it with the upper band, either a stretch or a break of the RTI line can sell. This line is not the 4-hour price line.

### VWAP in the candle

**Idea.** This candle touched the session VWAP, even if it did not close there.

**Both sides.** The low is at or under VWAP, and the high is at or over VWAP. A wick through VWAP passes. A candle entirely above or entirely below it fails. The starter requires this on the buy, and leaves the sell off.

**With others.** AND it with the lower band and the touch has to happen on the same bar as the dip. A dip that never comes back to VWAP does not buy. Do not confuse this card with the next one.

### Close versus VWAP

**Idea.** Where the bar finished, not whether a wick touched VWAP.

**Buy.** The close is at or under VWAP. Starts off.

**Sell.** The close is at or over VWAP. The starter turns this on.

**With others.** A wick through VWAP and a close above it passes "in the candle" and fails the buy on this card. The starter uses the two cards on opposite sides for that reason: the buy wants a tag, the sell wants the close to have finished on the high side of VWAP. Requiring both on the same side is stricter. "In the candle" AND "close at or under VWAP" means the candle straddled VWAP and closed on the low side of it.

### 20-hour, 50-hour, and 100-hour EMAs

**Idea.** The close compared with one hourly exponential average. You can change the hour count. The name on the card follows it. All three start off.

**Buy.** The close is at or above that average.

**Sell.** The close is at or under that average.

**With others.** These fight a dip book. The starter buy wants the close down at the lower band. "Close above the 20-hour average" is often false on that same bar, and an AND will block the buy. Use the 4-hour trend line as the trend gate instead. Use an hourly EMA on the sell side, or leave it off.

Until enough hours exist, the test fails and an AND blocks that side. The desk prints how many hours the tape has.

### EMA relations A, B, and C

**Idea.** The close and the three hourly averages compared with each other. They do not build a new average. Three slots, all off. A is a stack. B is a touch. C is a gap.

**Rank.** The lines must sit in the order you list, each strictly above the next. Equal fails. Fast, then mid, then slow passes only when the 20-hour is above the 50-hour and the 50-hour is above the 100-hour. Sell reverses, on by default, flips the list for the sell, so the same slot sells when the stack is upside down. Turn sell-reverses off if the sell should demand the same order as the buy.

**Touch.** The highest and lowest of the chosen lines are within a tolerance. The tolerance is a percent of the close, or a dollar amount. Starter **0.25%**. If you pick one average and you do not pick Close, the test is the close versus that average.

**Gap.** The same spread, the other way. "At least" passes when the lines are far apart. "At most" passes when they are close. Starter gap **1%**.

A rank with fewer than two lines fails. A touch or a gap with no average fails. While that slot is AND, the failure blocks the side.

**With others.** "The 20, 50, and 100 are congruent, and RTI is under 1" is relation B (or C set to "at most"), AND RTI below. The tolerance is the "set value." This does not also say the stack is under a dollar price. To involve the close, add Close to the lines in the slot. AND the rank of A when you also want the stack right-side up, not merely tight. A tight stack in a downtrend still passes a touch.

### Trend slope

**Idea.** The fitted line over the trend hours is rising or falling. Starter window **4 hours**. On 5-minute bars that is 48 bars. Both sides start off. On a daily tape the window is too short and the test fails.

**Buy.** The slope is at least the buy floor. The floor starts at **0%**, so a rising fit passes and a flat fit does not.

**Sell.** The slope is at or under the sell floor. The floor starts at **0%**, so a flat or falling fit passes. It is not the negative of the buy floor unless you set it that way.

**With others.** Independent of the trend-line card. You can require a rising fit, a close above the line, both, or neither. A buy floor of 0 and the line card ANDed means "the path is rising and price is on it."

### Trend line

**Idea.** The close compared with that same fitted line. Starts off.

**Buy.** The close is at or above the line.

**Sell.** The close is at or under the line.

**With others.** This is the gate in the robust book: money flow may buy only while the close is on or above the 4-hour line. A dip that is also under the line does not buy. The slope card is not required for that. Selling when the close falls back through the line is this card's sell side. If that sell is AND with a last-fill target, you will not take the target until price is also under the line. Put the target on OR, or in its own matrix row, if either reason should be enough to sell.

### Last fill

**Idea.** A dollar step from this book's own last fill. It does not look at the market's previous trade. It starts off. The chart can draw the step as a horizontal line.

**Sell, the target.** Once this book has a buy, the close is at least the "dollars above the last buy" over that price. Starter **$1**: a buy at 40.00 sells at a close of 41.00 or higher.

**Sell, the stop.** With the stop on, the same sell also passes when the close is under the last buy by the stop amount. A stop of **$0.20** after a buy at 40.00 sells at a close under 39.80. A close equal to the buy does not sell. Zero means any close under the fill. The target and the stop are one card. Either one is enough.

**Buy, the pullback.** Once this book has a sell, the close is at least the "dollars below the last sell" under that price.

**Buy, whenever flat.** The flat-buy switch passes on every bar. The book still buys only when it is flat, so this does not pyramid. Until the book has sold once, the dollar pullback is waiting, not failing, so the first entry can come from the flat buy or from another buy test.

**With others.** If this card is AND, a failed step blocks that side unless an OR rule passes. If it is OR, a passing step fires even when the other rules fail. The robust book uses it as the only sell: $2 above the last buy, or $1.25 under it, and drop hold is off so the stop is allowed to fill. For a book of many small gains, set the target to $0.20, the stop to $0.20, and decide whether the flat buy is the entry or whether a dip rule is.

## 4. Drop hold

Drop hold never buys and never sells. It blocks sells after a sharp drop, until price has recovered part of the way.

Starter: on, drop **10%**, recover **50%**. The reference is the prior session's last close, not today's high.

Prior close 100. The line is 90. The session low trades 88, so the hold latches. Recovery is halfway back: 88 + 0.5 × (100 − 88) = 94. Sells are blocked until a close at or above 94.

A buy does not wait for that. If a buy fills at 89, the hold cancels on that bar and stays off for the rest of the session, even if price later prints 80. A buy that happened before the breach does the same: a later breach does not start a hold. The next session starts clean.

On the sell strip, **Not Held** is high when the sale is free and low when it is blocked. It is not part of the ALL tick. The ALL tick can be high on a bar that still does not sell.

Turn drop hold off when a stop must be allowed to sell into the drop. The robust book does that. Leave it on when you would rather wait for a bounce than sell the hole.

## 5. Worked books

These are settings, not promises. Press **Recalculate**, then read the blotter.

### The starter book

One AND group on each side. The matrix is off.

**Buy, all of these.** Close at or under 102% of the lower band. Middle-band slope at least −1% over 5 bars. Volume at least 1.5 times its 20-bar average. RSI at or under 30. Money flow at or under 50. VWAP inside the candle.

**Sell, all of these.** Close at or over 98% of the upper band. RSI at or over 60. Close at or over VWAP.

**Also.** Drop hold 10% / 50%. Last fill, the hourly averages, the trend tests, and RTI are off.

A buy bar, in round numbers. Close 100. Lower band 98.5, so 102% is 100.47, and 100 is under it. Slope −0.4%, which is above −1. Volume 1.6 times. RSI 28. Money flow 42. The candle's low is 99.2, VWAP is 99.8, and the high is 100.4, so VWAP is inside the candle. The account is flat. That bar buys.

Change only the volume to 1.1 times. The AND fails. Nothing else has to be consulted. The bar does not buy.

A sell bar that does not sell. Upper band, RSI, and VWAP all pass, but the session low already breached 10% under the prior close and this book has not bought today. Not Held is low. The sell is skipped.

### The robust book

The **Robust book** button loads this and recalculates.

**Buy.** Money flow length 21, at or under 30, AND the close on or above the 4-hour line.

**Sell.** Last fill only. $2 above the last buy, or $1.25 under it. Money-flow sell is off, so a hot reading is not the exit.

**Also.** Drop hold off, so the stop can fill during a drop.

The trend line is the gate. A money-flow dip under the line does not buy. A dip above the line does, even if RSI and the bands say nothing, because those cards are off. The exit does not wait for the upper band. It waits for two dollars of profit, or it cuts a dollar and a quarter of loss.

### Many small gains, with a stop under the buy

**Buy.** Whichever dip you trust, or the flat-buy switch if you want an entry whenever the book is flat. If the flat buy is AND with a dip rule, both must pass. If the flat buy is OR, it buys even when the dip rule fails, and you will be in almost every bar the book is flat.

**Sell.** Last fill. Dollars above the last buy **0.20**. Stop on, dollars under the last buy **0.20**.

A buy at 40.00 then sells at a close of 40.20 or higher, or at a close under 39.80. A close of 40.00 sells neither. Drop hold should be off, or the stop will sit through the drop until the recovery rule lets go. Fees matter here even when the broker's commission is zero: the percent fee field is how you see the drag of a few cents on a twenty-cent target.

### A dip, but only in an uptrend

**Buy, switches.** Money flow AND the 4-hour trend line. Leave the lower band off, or AND it too if the dip must also tag the band.

**Sell, switches.** Last fill as OR, so the target or the stop can fire alone. Trend-line sell as OR if falling back through the line should also be enough. If you set the trend-line sell to AND, the dollar target will not fill until price is also under the line.

This is still one AND group plus loose ORs. You do not need the matrix.

### Two different dip recipes

You want a buy when the lower band and RSI agree, or when the lower band and money flow agree, or when RSI and the trend line agree. A lone RSI is not enough. The switches cannot say this. The buy matrix can.

| Row | Lower band | RSI | Money flow | Trend line |
| --- | --- | --- | --- | --- |
| G1 | marked | marked | | |
| G2 | marked | | marked | |
| G3 | | marked | | marked |

Turn the four buy switches on, turn **Use rows** on, and leave the other cells blank. A bar with the lower band and money flow, and a failed RSI, still buys on G2. A bar with only RSI buys on nothing.

The sell side can keep the switches. The matrix is per side.

### A tight stack and a washed-out RTI

**Buy, one AND group or one matrix row.** EMA relation B, touch, the 20-hour, 50-hour, and 100-hour lines, tolerance 0.25% or whatever "congruent" means to you. RTI below, level 1, or a higher level if 1 never prints.

That buys when the three averages are within the tolerance and the RTI reading is at or under the level. It does not also require the stack to be under a dollar price. Add Close to the touch if the close has to be in the cluster. AND relation A as well if the stack must be right-side up, not merely tight. A tight stack pointing the wrong way still passes a touch.

**Sell.** RTI line, sell on, if the exit is "RTI back under its own average." Give that sell its own OR, or its own matrix row, if a last-fill stop should also be able to sell.

### Sell the RTI break, and also sell a stop

**Sell matrix.**

| Row | RTI line | Last fill |
| --- | --- | --- |
| G1 | marked | |
| G2 | | marked |

G1 sells while the reading is under its line, whether or not the stop has hit. G2 sells on the target or the stop, whether or not RTI has broken. One row with both cells marked would wait for the break and the dollar step on the same bar, which is a different book.

### What not to AND

- A lower-band buy and "close above the 20-hour EMA." The dip and the trend filter are fighting. Use the 4-hour line, which can be above the price while the close is still at the lower band, or use it the other way: only buy dips that are above the line.
- An upper-band sell and a stop, both as AND. The stop will not fill until price is also at the upper band. The stop belongs on OR, or in its own row.
- Volume as OR, unless a busy bar by itself is a reason to trade.
- RTI direction as OR next to RTI strength. The strong bar already passes direction. AND them.
- Drop hold on, and a stop you expect to sell the hole. The hold will skip that sell.

## 6. Reading one bar

The strips under the candles use the same horizontal scale.

| Mark | Meaning |
| --- | --- |
| High | That rule, or that matrix row, is true. |
| Low | It is false. |
| Dashed mid-line | Waiting, and not in the combination. |
| ALL | The combination is true. Not a fill. Cash, an open position, or a hold can still skip it. |

With the switches, each lane is one rule and the caption shows AND or OR. With the matrix, each lane is one row. Not Held is on the sell strip only. High means free. Low means the sale is blocked. It is not part of ALL.

The candle read names the rules that fired. The blotter names them on the fill. If ALL was high and the blotter has no fill, the book was already long, already flat, short of settled cash, outside the date range, or the sale was held.

## 7. If you want this, turn on that

| You want | Turn on |
| --- | --- |
| The dip the desk ships with | Leave the starter switches. Matrix off. |
| A slower dip, only above the 4-hour line, with a target and a stop | **Robust book**. |
| Many small round trips and a stop under the buy | Last fill sell, your dollar target, stop on. Drop hold off. |
| Either of two dip recipes | Buy matrix. One row per recipe. |
| The averages tight, and RTI washed out | EMA relation touch, AND RTI below. |
| Buy while RTI is negative | RTI negative, buy on. A reading of zero does not pass. |
| Buy an RTI valley, or sell an RTI peak | RTI reversal. Periods is the width of the turn. |
| Sell when RTI breaks its line, or on a stop | Sell matrix. One row for the RTI line, one row for last fill. |
| Do not sell into a 10% hole | Drop hold on. Do not also expect the stop to fill during that hole. |
| A rule that must agree with the others | AND, or a mark in the same row. |
| A rule that may fire alone | OR, or a row that contains only that rule. |
