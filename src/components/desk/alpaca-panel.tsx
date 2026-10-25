import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { alpacaLook, alpacaSend, type AlpacaLook, type AlpacaOrderView } from "@/lib/desk/alpaca-api";
import { readLiveArm, type LiveArm } from "@/lib/desk/alpaca";
import { formatMoney, formatPx, formatQty } from "@/lib/desk/model";

const LIVE_KEY = "strategy-desk-live-v1";

export function AlpacaPanel({
  symbol,
  dollars,
  price,
  barTime,
  signal,
  sample,
  from,
  to,
  onAccount,
  onRefresh,
}: {
  symbol: string;
  dollars: number;
  price: number;
  barTime: number;
  signal: "buy" | "sell" | "none";
  sample: boolean;
  from: number;
  to: number;
  onAccount: (view: AlpacaLook | null) => void;
  onRefresh: () => void;
}) {
  const look = useServerFn(alpacaLook);
  const send = useServerFn(alpacaSend);
  const lookRef = useRef(look);
  const sendRef = useRef(send);
  lookRef.current = look;
  sendRef.current = send;
  const [view, setView] = useState<AlpacaLook | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(false);
  const [liveArm, setLiveArm] = useState<LiveArm | null>(null);
  const sent = useRef(new Set<string>());
  const floor = useRef(0);
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
    if (!keep) return;
    const timer = window.setInterval(() => refreshRef.current(), 60_000);
    return () => window.clearInterval(timer);
  }, [keep]);

  async function submit(side: "buy" | "sell", time: number) {
    const key = `${symbol}|${side}|${time}`;
    if (sent.current.has(key)) return;
    sent.current.add(key);
    setBusy(true);
    setNote("");
    try {
      const result = await sendRef.current({
        data: { symbol, side, dollars, price, barTime: time, sample, liveArm },
      });
      if (!result.ok) {
        sent.current.delete(key);
        setNote(result.error);
        return;
      }
      setNote(orderNote(result.order, price));
      const next = await lookRef.current({ data: { symbol, from: rangeRef.current.from, to: rangeRef.current.to } });
      if (next.ok) {
        setView(next);
        accountRef.current(next);
      }
    } catch {
      sent.current.delete(key);
      setNote("The desk could not reach Alpaca.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!keep || signal === "none" || !(barTime > floor.current)) return;
    void submit(signal, barTime);
    // submit is recreated each render; the sent set stops a second order for this bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keep, signal, barTime, symbol]);

  const liveBlocked = view != null && !view.paper && !liveArm;
  return (
    <section className="desk-panel p-4" data-testid="alpaca-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-medium">Alpaca</h2>
        <p className="text-xs text-muted">{view ? (view.paper ? "Paper account" : "Live account") : "Not connected"}</p>
      </div>
      <p className="mt-2 text-sm text-muted text-pretty">
        Play money stays on its own tab. This panel sends one order for the latest bar, and only the side the Alpaca position allows: a buy when the account is flat, a sell when it is long. It does not replace a signal that passed while the desk was off. An open triangle on the chart is that missed signal. A solid triangle is a fill.
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
            <dt className="text-xs text-muted">This bar</dt>
            <dd>{signal === "none" ? "No order" : signal === "buy" ? "Buy" : "Sell"}</dd>
          </div>
        </dl>
      )}
      {!view?.marketOpen && view && (
        <p className="mt-2 text-sm text-muted text-pretty">The market is closed. Alpaca can accept the order and fill it at the next open. The row below shows that status.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="desk-chip"
          data-on="true"
          disabled={busy || signal === "none" || sample || liveBlocked}
          onClick={() => void submit(signal === "sell" ? "sell" : "buy", barTime)}
        >
          {busy ? "Sending" : "Send this signal"}
        </button>
        <button
          type="button"
          className="desk-chip"
          data-on={keep}
          onClick={() => {
            floor.current = barTime;
            setKeep((value) => !value);
          }}
        >
          {keep ? "Sending each new bar" : "Send each new bar"}
        </button>
      </div>
      {sample && <p className="mt-2 text-sm text-muted">This tape is a sample. Load a market tape before sending an order.</p>}
      {liveBlocked && <p className="mt-2 text-sm text-bronze">These are live keys. Load the live key file before an order can be sent.</p>}
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

function orderNote(order: AlpacaOrderView, close: number): string {
  if (order.filledAvgPrice != null && order.filledQty > 0) {
    return `Filled ${order.filledQty} at ${formatPx(order.filledAvgPrice)}. The signal close was ${formatPx(close)}.`;
  }
  return `Alpaca has the order as ${order.status.replaceAll("_", " ")}. A fill shows here when Alpaca reports one.`;
}
