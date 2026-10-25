# Opening a brokerage account for this desk

Strategy Desk 1.6.0. This page is the signup on your own computer. It does not open a brokerage account. Paper orders are sent only when you press send on the Alpaca panel. Live orders also need the live key file.

You open the account at the firm. You create that firm's keys there. You paste only the keys this desk asks for. The firm's own password stays at the firm. The desk password only unlocks this copy.

The keys are sealed on this computer. They are not sent to another Strategy Desk, and they are not stored in the browser. Play money still fills on its own. An Alpaca paper order is a separate fill at Alpaca.

## What you do once, on this computer

1. Open the desk at `http://127.0.0.1:8080`.
2. The first visit is **Create this desk**. Enter an email and a password of at least 8 characters. This is not the brokerage login.
3. Choose one of the four firms. Fill in only the boxes that firm needs. Leave **Paper account** checked until you mean a live account.
4. Press **Create this desk**. The next visits ask for the email and the password only.
5. **Change brokerage** replaces the stored firm. It does not create a second owner. One computer has one owner.

A second person installs their own copy and does the same thing. The two desks do not share a user list.

## What will not match when a live order exists later

The blotter fills at the close of the signal bar. A whole number of shares. One long position. Cash, not margin. The play-money fee boxes are whatever you saved. The Actual book has those fees at zero.

A live order, once this desk is armed in a later version, would differ in these ways.

- The fill is the firm's price when the order arrives, not the close the signal used. On a liquid ETF that is often a penny or two a share. On a wide quote it is more.
- The desk sizes the order from its own cash figure. The firm sizes buying power from settled cash. If those two numbers differ, the firm can reject the order or fill a different share count.
- The desk assumes the whole order fills. A live order can fill in part, or not at all, if the market is closed, the symbol is halted, or settled cash is short.
- This book is long-only and cash. It does not use margin, shorts, or fractional shares. A margin account at the firm can add the pattern-day-trader rule: under $25,000, four day trades in five business days can lock the account. A cash account is limited by settled cash instead. Open a cash account unless you mean to use margin.
- US stock settlement is the next business day. The Actual book waits one day and uses confirmed sale proceeds. That is the right shape. The firm's settled-cash number can still disagree with the blotter.
- A broker paper account is a second simulation. It will not reprint this blotter. Use play money to judge the book. Use the firm's paper account only to prove the key works.
- Saving a key does not place a trade. Nothing in this version calls the firm.

## Alpaca

**Account.** Open a brokerage account at [alpaca.markets](https://alpaca.markets). There is no minimum deposit and no inactivity fee. Approval is Alpaca's decision. US listed stocks and ETFs are $0 commission for a normal retail account. Regulatory fees on sales still apply.

**Paper.** Paper is a separate account with its own key and secret. You can create it before the live account is approved. In the desk, check **Paper account** and paste the paper pair. Uncheck it only when you paste the live pair. A paper key cannot place a live order, and a live key is real money.

**Keys.** In the Alpaca dashboard, open API keys for the account you mean. Copy the key into **API key** and the secret into **API secret**. The secret is shown once. If you lose it, generate a new pair and paste that. Do not paste the key into email or into a saved-book JSON. Saved books do not contain these keys.

**Login limits.** The key does not expire on a seven-day clock. It works while the account is open and the key has not been revoked. Paper and live are different hosts. This desk calls the host that matches the Paper account box. It sends a market order only from the Alpaca panel, and only for the latest signal.

**Minimums and trade count.** No minimum deposit. No required number of trades. The free market-data feed is IEX only, 200 requests a minute, 30 symbols. The full US tape is optional at $99 a month. This desk builds its own bars, so you do not need that feed to study a book. A later live order would still need a quote at send time. The Elite Smart Router is optional. It is not required for this desk. A business deposit, on Alpaca's own page, is what unlocks that router. It changes the commission. It is not an account minimum.

**Live versus the blotter.** Retail market orders go to a wholesaler. Alpaca is paid from the spread, up to 12% of the spread and not more than 5 cents a share, on a marketable order in the regular session. You do not see that as a commission. You see it as a fill that is not the bar close.

## Charles Schwab

**Account.** Open a brokerage account at [schwab.com](https://www.schwab.com). An individual brokerage account has no minimum deposit. US listed stocks and ETFs are $0 commission online. Regulatory fees on sales still apply.

**Paper.** Schwab does not give this API a paper account. thinkorswim paperMoney is a different product and does not produce this key. Leave the desk on play money to test the book. There is no sandbox pair to paste. If you later arm a live order, it is a real order.

**Keys.** Go to the Schwab developer portal and create an individual app. Wait until Schwab approves it. Approval is manual. Copy the app key and the app secret into this desk. Those two values identify the app. They are not enough, by themselves, to place an order.

The trading session is a refresh token. Schwab shows it after you approve the app in a browser. Paste it into **Refresh token** when you have it. You may leave that box empty on the day you create the desk. This desk does not open Schwab's login page for you. The access token that sits in front of the refresh token lasts about 30 minutes. Do not store that one. It is replaced from the refresh token.

**Login limits.** The refresh token dies in about 7 days. You approve the app again in a browser, then paste the new refresh token under **Change brokerage**. Miss the week and the session is dead. Nothing trades until you do that. Two refreshes at the same moment can invalidate each other. This desk does not refresh it yet.

The callback URL has to be one you registered on the app. When this desk grows a login redirect, that URL will be `http://127.0.0.1:8080` on your machine. Until then, register the callback Schwab requires for the manual approval and keep the app marked for your own use.

**Minimums and trade count.** No minimum deposit. No required number of trades. The API and the US equity data that come with an approved individual app have no separate monthly fee. Schwab can throttle a noisy app. This book's handful of orders a day is not that.

**Live versus the blotter.** A marketable order fills at Schwab's price, not at the bar close. Because there is no paper API, the first real call is a live account. Do not arm that until the play-money blotter is the book you want.

## E*TRADE

**Account.** Open a brokerage account at [etrade.com](https://us.etrade.com). An individual brokerage account has no minimum deposit. US listed stocks and ETFs are $0 commission. Regulatory fees on sales still apply. Options are a separate schedule and this desk does not trade them.

**Paper.** E*TRADE's developer site has a sandbox. The sandbox has its own consumer key and secret. Check **Paper account** and paste the sandbox pair. Production keys are a second approval. Uncheck **Paper account** only for that production pair. The sandbox will not match the blotter. It only proves the key.

**Keys.** At the E*TRADE developer site, request a key for your own use. Copy the consumer key and the consumer secret into this desk. Those stay. An access token is a second step, and it does not stay.

E*TRADE uses OAuth 1.0a. The usual sequence is: get a request token, open E*TRADE's authorization page, sign in there, copy a verification code, then exchange that code for an access token and an access secret. Paste those two into the optional boxes when you have them. This desk does not run that sequence yet. Production access is a separate request after the sandbox key works. A vendor key is a different approval. You do not need one for your own desk.

**Login limits.** The access token expires at midnight US Eastern. After midnight you sign in again and paste a new token. If the app makes no call for two hours, the token goes idle. E*TRADE has a renew call that wakes it without a new login. This desk does not send that call yet. A desk that is off for the night will need a new token in the morning.

**Minimums and trade count.** No minimum deposit. No required number of trades. The developer key for your own account is not a priced API plan.

**Live versus the blotter.** Same bar-close gap as the others. A sandbox fill is not a market fill. A production token after midnight is a dead token, so a signal that fires before you paste a new one does not become an order.

## Interactive Brokers

**Account.** Open an individual account at [interactivebrokers.com](https://www.interactivebrokers.com). Interactive Brokers does not publish a minimum deposit for that account. A US resident can choose Lite or Pro.

- Lite is $0 commission on US listed stocks and ETFs. It is only for US residents. Regulatory fees still apply. Order routing is the retail route.
- Pro Fixed is $0.005 a share, minimum $1 an order. On the Actual book that commission was $105.73 before regulatory fees. Exchange and clearing fees are inside that rate. Regulatory fees are extra.
- Pro Tiered starts at $0.0035 a share, minimum $0.35, and then adds exchange, clearing, and regulatory fees. The exchange piece is not known until the order is routed.

This desk's stock book does not need Pro. Lite is the matching $0 commission account if you are a US resident. Use Pro only if you want that routing or you are outside the US. Lite is not available outside the US.

**Paper.** Paper is a separate username, issued from Client Portal. It is not a checkbox inside the live login. Check **Paper account** in the desk when you will log the gateway in with the paper user. Log the gateway in with the live user only when you mean a live account, and uncheck the box. The desk stores the account id. It does not store the Interactive Brokers password.

**Keys.** You do not get a simple key and secret for a retail account.

1. Download the Client Portal Gateway from Interactive Brokers and run it on this same computer.
2. It listens on this machine. The desk's default address is `127.0.0.1:5000`. Change that box if you start the gateway on another port.
3. Open the gateway's own page in a browser and log in there, with the paper user or the live user.
4. Copy the account id, the value that looks like `U1234567`, into **Account id**.

The gateway is the session. If it is not logged in, nothing can be sent later, no matter what the desk has stored.

**Login limits.** The gateway session does not survive on its own. It drops when the program stops, when the computer sleeps, and often overnight even if the program is open. You log in again on the gateway page. This is the same class of limit as Schwab's seven-day approval and E*TRADE's midnight token. The desk cannot trade through a dead gateway.

There is also a Grok connector for Interactive Brokers. That connector stores the session with Grok, not in this desk. Do not use it if the point of this page is that the keys stay on your computer. Alpaca, Schwab, and E*TRADE do not have that connector. The desk does not use it.

**Minimums and trade count.** No published minimum deposit for an individual account. No required number of trades. Market data for a live quote is a separate exchange fee, a few dollars a month for a US stock feed, and only if you subscribe. This desk does not need that feed to run play money.

**Live versus the blotter.** A gateway that is logged out turns a signal into nothing. A Lite fill is a retail fill, not the bar close. A Pro fill adds the commission above. Paper and live are different gateway logins, so a paper test never moves the live account.

## Which limitation matters for a book that runs all day

| Firm | What dies | What you do | Paper |
| --- | --- | --- | --- |
| Alpaca | Nothing on a clock, unless you revoke the key | Keep the paper pair and the live pair apart | Separate keys |
| Schwab | Refresh token, about 7 days | Approve again and paste the new token | No API paper account |
| E*TRADE | Access token at midnight Eastern, and after 2 idle hours | Sign in again, or a renew call this desk does not send yet | Sandbox keys |
| Interactive Brokers | Gateway session, often overnight | Log in on the gateway page on this computer | Separate paper username |

None of the four charges a stock commission on a normal US stock or ETF order except Interactive Brokers Pro. All four pass the SEC fee on sales. That fee is $20.60 per $1 million sold. The FINRA trading-activity fee is $0 from October 1 through December 31, 2026, and $0.000195 a share sold outside that window, capped per sale. Alpaca and Interactive Brokers also pass an audit-trail fee of $0.000003 a share.

The Actual book, 33 round trips on the SOXL 5-minute tape from July 31 through October 23 2026, costs $27.51 at Alpaca, $27.45 at Schwab, $27.45 at E*TRADE, and $27.51 at Interactive Brokers Lite. Those totals leave out the price of the shares. Interactive Brokers Pro Fixed on that same book is $133.24.
