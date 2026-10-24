import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { DeskApp } from "@/components/desk/desk-app";
import { loginGate, logoutGate, readGate, setupGate, updateBroker } from "@/lib/desk/vault.server";
import { BROKERS, type BrokerId } from "@/lib/desk/vault-brokers";
import { BROKER_PATH } from "@/lib/desk/version";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

type GateState =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "login" }
  | { kind: "desk"; email: string; broker: string; paper: boolean };

function openDoc(event: { preventDefault(): void }) {
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname);
  if (!prefix) return;
  event.preventDefault();
  window.open(`${prefix}${BROKER_PATH}`, "_blank", "noopener");
}

function DocLink({ children }: { children: ReactNode }) {
  return (
    <a href={BROKER_PATH} target="_blank" rel="noopener" className="text-bronze" onClick={openDoc}>
      {children}
    </a>
  );
}

function Field({
  label,
  value,
  secret,
  long,
  autoComplete,
  onChange,
}: {
  label: string;
  value: string;
  secret?: boolean;
  long?: boolean;
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  const className = long ? "desk-input mt-1 h-auto min-h-24 py-2" : "desk-input mt-1";
  return (
    <label className="block text-xs text-muted">
      {label}
      {long ? (
        <textarea className={className} value={value} autoComplete={autoComplete ?? "off"} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          className={className}
          type={secret ? "password" : "text"}
          value={value}
          autoComplete={autoComplete ?? "off"}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function BrokerForm({
  broker,
  setBroker,
  paper,
  setPaper,
  fields,
  setField,
}: {
  broker: BrokerId;
  setBroker: (id: BrokerId) => void;
  paper: boolean;
  setPaper: (value: boolean) => void;
  fields: Record<string, string>;
  setField: (id: string, value: string) => void;
}) {
  const choice = BROKERS.find((item) => item.id === broker) ?? BROKERS[0];
  return (
    <div className="mt-4">
      <p className="text-xs text-muted">Brokerage</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {BROKERS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-on={item.id === broker}
            className="desk-chip h-auto min-h-11 justify-start rounded-md px-3 text-left"
            onClick={() => setBroker(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted text-pretty">{choice.blurb}</p>
      <div className="mt-3 flex flex-col gap-3">
        {choice.fields.map((field) => (
          <Field
            key={field.id}
            label={field.optional ? `${field.label} (optional)` : field.label}
            value={fields[field.id] ?? (field.id === "gateway" ? "127.0.0.1:5000" : "")}
            secret={field.secret}
            long={field.long}
            onChange={(value) => setField(field.id, value)}
          />
        ))}
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={paper} onChange={(event) => setPaper(event.target.checked)} />
        Paper account. Uncheck this only for a live account. The desk still will not send an order.
      </label>
      <p className="mt-2 text-sm text-bronze text-pretty">{choice.limitation}</p>
    </div>
  );
}

export function Gate() {
  const load = useServerFn(readGate);
  const setup = useServerFn(setupGate);
  const signIn = useServerFn(loginGate);
  const changeBroker = useServerFn(updateBroker);
  const signOut = useServerFn(logoutGate);
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [broker, setBroker] = useState<BrokerId>("alpaca");
  const [paper, setPaper] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({ gateway: "127.0.0.1:5000" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  async function refresh() {
    const next = await load();
    if (!next.ready) setState({ kind: "setup" });
    else if (!next.signedIn) setState({ kind: "login" });
    else setState({ kind: "desk", email: next.email, broker: next.broker.name, paper: next.broker.paper });
  }

  useEffect(() => {
    let cancel = false;
    load()
      .then((next) => {
        if (cancel) return;
        if (!next.ready) setState({ kind: "setup" });
        else if (!next.signedIn) setState({ kind: "login" });
        else setState({ kind: "desk", email: next.email, broker: next.broker.name, paper: next.broker.paper });
      })
      .catch(() => {
        if (!cancel) setError("This desk could not read its local sign-in file.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  function setField(id: string, value: string) {
    setFields((current) => ({ ...current, [id]: value }));
  }

  async function onSetup(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await setup({ data: { email, password, broker, paper, fields } });
      if (!result.ok) setError(result.error);
      else await refresh();
    } catch {
      setError("This desk could not save the sign-in.");
    } finally {
      setBusy(false);
    }
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await signIn({ data: { email, password } });
      if (!result.ok) setError(result.error);
      else {
        setPassword("");
        await refresh();
      }
    } catch {
      setError("This desk could not sign you in.");
    } finally {
      setBusy(false);
    }
  }

  async function onUpdate(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await changeBroker({ data: { broker, paper, fields } });
      if (!result.ok) setError(result.error);
      else {
        setEditing(false);
        await refresh();
      }
    } catch {
      setError("This desk could not save the brokerage.");
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await signOut();
    setPassword("");
    setEditing(false);
    await refresh();
  }

  if (state.kind === "loading") {
    return <p className="px-4 py-8 text-sm text-muted">Checking this desk.</p>;
  }

  if (state.kind === "desk") {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-muted">
          <p>
            Signed in as <span className="text-paper">{state.email}</span>
            {" · "}
            {state.broker} {state.paper ? "paper" : "live keys"}
            {" · "}
            <DocLink>Broker setup</DocLink>
          </p>
          <div className="flex gap-2">
            <button type="button" className="desk-chip h-8 px-3 text-xs" onClick={() => setEditing((value) => !value)}>
              {editing ? "Close" : "Change brokerage"}
            </button>
            <button type="button" className="desk-chip h-8 px-3 text-xs" onClick={() => void onLogout()}>
              Sign out
            </button>
          </div>
        </div>
        {editing && (
          <form onSubmit={onUpdate} className="shrink-0 border-b border-line px-4 py-4">
            <div className="mx-auto max-w-xl">
              <BrokerForm broker={broker} setBroker={setBroker} paper={paper} setPaper={setPaper} fields={fields} setField={setField} />
              {error && <p className="mt-3 text-sm text-sell">{error}</p>}
              <button type="submit" className="desk-chip mt-4" data-on="true" disabled={busy}>
                {busy ? "Saving" : "Save brokerage"}
              </button>
            </div>
          </form>
        )}
        <div className="min-h-0 flex-1">
          <DeskApp />
        </div>
      </div>
    );
  }

  const setupMode = state.kind === "setup";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-medium tracking-tight">Strategy Desk</h1>
      <p className="mt-2 text-sm text-muted text-pretty">
        {setupMode
          ? "Create the one sign-in for this computer. It does not open a brokerage account, and it does not send an order. The keys stay in an encrypted file on this machine."
          : "Sign in to this computer’s desk. The brokerage keys are already stored here."}
      </p>
      <form onSubmit={setupMode ? onSetup : onLogin} className="desk-panel mt-6 p-4">
        <Field label="Email" value={email} autoComplete="username" onChange={setEmail} />
        <div className="mt-3">
          <Field label="Password" value={password} secret autoComplete={setupMode ? "new-password" : "current-password"} onChange={setPassword} />
        </div>
        {setupMode && (
          <>
            <div className="mt-3">
              <Field label="Password again" value={confirm} secret autoComplete="new-password" onChange={setConfirm} />
            </div>
            <BrokerForm broker={broker} setBroker={setBroker} paper={paper} setPaper={setPaper} fields={fields} setField={setField} />
          </>
        )}
        {error && <p className="mt-3 text-sm text-sell">{error}</p>}
        <button type="submit" className="desk-chip mt-4" data-on="true" disabled={busy}>
          {busy ? "Saving" : setupMode ? "Create this desk" : "Sign in"}
        </button>
        <p className="mt-4 text-sm text-muted text-pretty">
          <DocLink>How to open each brokerage account and where the keys come from.</DocLink>
        </p>
      </form>
    </main>
  );
}
