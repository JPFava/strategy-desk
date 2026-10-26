import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { alpacaLook, type AlpacaLook } from "@/lib/desk/alpaca-api";
import { sessionArm, sessionDisarm, sessionOnce, sessionRead, type SessionPublic } from "@/lib/desk/session-api";
import { readLiveArm, type LiveArm } from "@/lib/desk/alpaca";
import { formatMoney, formatPx, formatQty, type AccountSettings, type DeskParams, type Interval } from "@/lib/desk/model";

const LIVE_KEY = "strategy-desk-live-v1";

export function AlpacaPanel({
  symbol,
  signal,
  sample,
  from,
  to,
  onAccount,
  onRefresh,
  params,
  account,
  interval,
}: {
  symbol: string;
  signal: "buy" | "sell" | "none";
  sample: boolean;
  from: number;
  to: number;
  onAccount: (view: AlpacaLook | null) => void;
  onRefresh: () => void;
  params: DeskParams;
  account: AccountSettings;
  interval: Interval;
}) {
  const look = useServerFn(alpacaLook);
  const arm = useServerFn(sessionArm);
  const once = useServerFn(sessionOnce);
  const disarm = useServerFn(sessionDisarm);
  const read = useServerFn(sessionRead);
  const lookRef = useRef(look);
  const readRef = useRef(read);
  lookRef.current = look;
  readRef.current = read;
  const [view, setView] = useState<AlpacaLook | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<SessionPublic | null>(null);
  const [slippageCents, setSlippageCents] = useState(15);
  const [dailyLossPct, setDailyLossPct] = useState(3);
  const [allowClosed, setAllowClosed] = useState(false);
  const [liveArm, setLiveArm] = useState<LiveArm | null>(null);
  const refreshRef = useRef(onRefresh);
  const accountRef = useRef(onAccount);
  const rangeRef = useRef({ from, to });
  refreshRef.current = onRefresh;
  accountRef.current = onAccount;
  rangeRef.current = { from, to };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIVE_KEY);
      if (!raw) return;
      const next = readLiveArm(JSON.parse(raw));
      if (next) setLiveArm(next);
    } catch {
      /* a bad saved file is the same as no file */
    }
  }, []);

  useEffect(() => {
    if (liveArm) localStorage.setItem(LIVE_KEY, JSON.stringify(liveArm));
    else localStorage.removeItem(LIVE_KEY);
  }, [liveArm]);

  useEffect(() => {
    let cancel = false;
    const pull = () => {
      lookRef
        .current({ data: { symbol, from: rangeRef.current.from, to: rangeRef.current.to } })
        .then((next) => {
          if (cancel) return;
          if (!next.ok) {
            setView(null);
            accountRef.current(null);
            setError(next.error);
            return;
          }
          setError("");
          setView(next);
          accountRef.current(next);
        })
        .catch(() => {
          if (!cancel) {
            accountRef.current(null);
            setError("The desk could not reach Alpaca.");
          }
        });
    };
    pull();
    const timer = window.setInterval(pull, 20_000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [symbol, from, to]);

  useEffect(() => {
    let cancel = false;
    const pull = () => {
      readRef
        .current()
        .then((next) => {
          if (!cancel) setSession(next);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 5_000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, []);

  function job() {
    return { symbol, interval, params, account, slippageCents, dailyLossPct, allowClosed, liveArm };
  }

  async function onceSend() {
    setBusy(true);
    setNote("");
    try {
      const result = await once({ data: job() });
      if (!result.ok) setNote(result.error);
      else {
        setSession(result.session);
        setNote(result.session.decision);
      }
      refreshRef.current();
    } catch {
      setNote("The desk could not reach Alpaca.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleArm() {
    setBusy(true);
    setNote("");
    try {
      if (session?.armed) {
        const result = await disarm();
        setSession(result.session);
        setNote(result.session.decision);
      } else {
        const result = await arm({ data: job() });
        if (!result.ok) setNote(result.error);
        else {
          setSession(result.session);
          setNote(result.session.decision);
        }
      }
    } catch {
      setNote("The desk could not reach Alpaca.");
    } finally {
      setBusy(false);
    }
  }

  const liveBlocked = view != null && !view.paper && !liveArm;
  return (
    <section className="desk-panel p-4" data-testid="alpaca-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-medium">Alpaca</h2>
        <p className="text-xs text-muted">{view ? (view.paper ? "Paper account" : "Live account") : "Not connected"}</p>
      </div>
      <p className="mt-2 text-sm text-muted text-pretty">
        This page only displays the account and arms the desk. The process on this computer sends the order, and only after it reads the position, the open orders, and the clock. A restart leaves orders off. It sends a limit for the last closed bar: a buy when the account is flat, a sell when it is long. It does not replace a signal that passed while orders were off. Sleep stops it. An open triangle is an order Alpaca did not fill. A solid triangle is a fill. A signal that was never sent has no triangle.
      </p>
      {error && <p className="mt-2 text-sm text-sell">{error}</p>}
      {view && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted">Account</dt>
            <dd>{view.status || "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Market</dt>
            <dd>{view.marketOpen ? "Open" : "Closed"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Cash</dt>
            <dd className="font-mono tabular-nums">{formatMoney(view.cash)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Equity</dt>
            <dd className="font-mono tabular-nums">{formatMoney(view.equity)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{symbol} at Alpaca</dt>
            <dd>{view.positionQty > 0 ? `Long ${formatQty(view.positionQty)}` : view.positionQty < 0 ? `Short ${formatQty(Math.abs(view.positionQty))}` : "Flat"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Closed bar</dt>
            <dd>{signal === "none" ? "No order" : signal === "buy" ? "Buy" : "Sell"}</dd>
          </div>
        </dl>
      )}
      {!view?.marketOpen && view && (
        <p className="mt-2 text-sm text-muted text-pretty">The market is closed. The desk will not send unless you allow a closed-market order. A limit order can still fill at the next open.</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs text-muted">
          Slippage, cents
          <input className="desk-input mt-1" type="number" min={1} max={500} value={slippageCents} onChange={(event) => setSlippageCents(Number(event.target.value))} />
        </label>
        <label className="text-xs text-muted">
          Daily loss stop, %
          <input className="desk-input mt-1" type="number" min={0.5} max={50} step={0.5} value={dailyLossPct} onChange={(event) => setDailyLossPct(Number(event.target.value))} />
        </label>
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={allowClosed} onChange={(event) => setAllowClosed(event.target.checked)} />
        Allow an order while the market is closed
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="desk-chip" data-on="true" disabled={busy || sample || liveBlocked} onClick={() => void onceSend()}>
          {busy ? "Sending" : "Send this bar"}
        </button>
        <button type="button" className="desk-chip" data-on={session?.armed === true} disabled={busy || sample || liveBlocked} onClick={() => void toggleArm()}>
          {session?.armed ? "Turn orders off" : "Turn orders on"}
        </button>
      </div>
      {session?.decision && <p className="mt-2 text-sm">{session.decision}</p>}
      {sample && <p className="mt-2 text-sm text-muted">This tape is a sample. Load a market tape before sending an order.</p>}
      {liveBlocked && <p className="mt-2 text-sm text-bronze">These are live keys. Load the live key file before an order can be sent.</p>}
      {session?.stopped && <p className="mt-2 text-sm text-sell">The daily loss stop turned orders off. Arm them again only if you mean to.</p>}
      {note && <p className="mt-2 text-sm">{note}</p>}
      <label className="mt-3 block text-xs text-muted">
        Live key
        <input
          className="desk-input mt-1"
          type="file"
          accept="application/json,.json"
          data-testid="load-live"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void file.text().then((text) => {
              try {
                const next = readLiveArm(JSON.parse(text));
                if (!next) {
                  setNote("That file is not a live key.");
                  return;
                }
                setLiveArm(next);
                setNote(`Live key loaded for ${next.tester}. Live orders are still off until you send one.`);
              } catch {
                setNote("That file is not a live key.");
              }
            });
          }}
        />
      </label>
      {liveArm && (
        <button type="button" className="desk-chip mt-3" onClick={() => setLiveArm(null)}>
          Remove live key
        </button>
      )}
      {view && view.orders.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Side</th>
                <th className="py-1 pr-3 font-medium">Qty</th>
                <th className="py-1 pr-3 font-medium">Fill</th>
              </tr>
            </thead>
            <tbody>
              {view.orders.map((order) => (
                <tr key={order.id} className="border-t border-line">
                  <td className="py-1 pr-3">{order.status.replaceAll("_", " ")}</td>
                  <td className="py-1 pr-3">{order.side}</td>
                  <td className="py-1 pr-3 font-mono tabular-nums">{formatQty(order.filledQty || order.qty)}</td>
                  <td className="py-1 pr-3 font-mono tabular-nums">{order.filledAvgPrice != null ? formatPx(order.filledAvgPrice) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
