import { render } from "solid-js/web";
import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import type { SettingField } from "../../src/settings";
import type { RandomSelector } from "../../src/commands/random-selector";
import { CommandsEditor } from "./CommandsEditor";
import "./style.css";

interface SettingsResponse { fields: SettingField[]; env: Record<string, string>; secretSet: Record<string, boolean>; configured: boolean }
interface Status {
  applying: boolean; configured: boolean; error: string | null; novncUrl: string | null; configDir: string;
  chatzy: { state: string; alias: string; online: string[]; lastEventAt: number | null; failures: number; nextKeepaliveAt: number | null } | null;
  discord: { lastSuccessAt: number | null; lastError: string | null } | null;
}

async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api/${url}`, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (res.status === 401) throw new Error("Sign in required. Reload this page and enter your Web UI password.");
  const result = await res.json();
  if (!res.ok) throw new Error(result.error ?? `Request failed (${res.status})`);
  return result;
}

function App() {
  const [loaded, setLoaded] = createSignal(false);
  const [fields, setFields] = createSignal<SettingField[]>([]);
  const [env, setEnv] = createSignal<Record<string, string>>({});
  const [original, setOriginal] = createSignal<Record<string, string>>({});
  const [secrets, setSecrets] = createSignal<Record<string, boolean>>({});
  const [clearSecrets, setClearSecrets] = createSignal<Set<string>>(new Set());
  const [commandsDirty, setCommandsDirty] = createSignal(false);
  const [status, setStatus] = createSignal<Status>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  const dirty = () => JSON.stringify(env()) !== JSON.stringify(original()) || clearSecrets().size > 0;
  const groups = () => [...new Set(fields().map((f) => f.group))];
  const change = (key: string, value: string) => setEnv((v) => ({ ...v, [key]: value }));
  const applyResponse = (r: SettingsResponse) => {
    setFields(r.fields); setEnv(r.env); setOriginal({ ...r.env }); setSecrets(r.secretSet); setClearSecrets(new Set<string>());
  };
  const refresh = async () => {
    try { setStatus(await api<Status>("status")); } catch (e) { setError((e as Error).message); }
  };
  onMount(async () => {
    try {
      applyResponse(await api<SettingsResponse>("settings")); await refresh(); setLoaded(true);
    } catch (e) { setError((e as Error).message); }
  });
  const timer = setInterval(() => void refresh(), 5000);
  onCleanup(() => clearInterval(timer));
  const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty() || commandsDirty()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  onCleanup(() => window.removeEventListener("beforeunload", beforeUnload));

  async function action(fn: () => Promise<void>) {
    if (busy()) return;
    setBusy(true); setError(""); setMessage("");
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const saveSettings = () => action(async () => {
    const patch = { ...env() };
    for (const f of fields().filter((f) => f.type === "password")) {
      if (clearSecrets().has(f.key)) patch[f.key] = "";
      else if (!patch[f.key]) delete patch[f.key];
    }
    applyResponse(await api<SettingsResponse>("settings", "PUT", patch));
    setMessage("Settings saved and applied. The bot session is restarting; VNC password changes require a container restart.");
  });
  const time = (t: number | null | undefined) => t ? new Date(t).toLocaleTimeString() : "—";
  const safeVncUrl = () => { const url = status()?.novncUrl; return url && /^https?:\/\//i.test(url) ? url : undefined; };

  return <div class="app">
    <header>
      <div class="brand"><span class="logo">C<span>↗</span></span><div><h1>Chatzy Bot</h1><p>CONTROL ROOM</p></div></div>
      <a class="button secondary" href={safeVncUrl()} target="_blank" rel="noopener noreferrer" aria-disabled={!safeVncUrl()}>Open browser <span>↗</span></a>
    </header>
    <main>
      <div class="intro"><div><span class="eyebrow">YOUR ROOM, CONNECTED</span><h2>Make yourself at home.</h2><p>Fine-tune the bot, keep an eye on the room, and give it a little personality.</p></div><span class="pill">Chatzy → Discord</span></div>
      <Show when={error()}><div role="alert" class="notice error">{error()}</div></Show>
      <Show when={message()}><div role="status" class="notice success">{message()}</div></Show>
      <Show when={status()?.error}><div role="alert" class="notice error">{status()?.error}</div></Show>
      <section class="status-grid" aria-label="Live status">
        <div class="stat"><span class="stat-label">ROOM CONNECTION</span><strong><i classList={{ online: status()?.chatzy?.state === "connected" }} />{status()?.applying ? "Applying settings…" : status()?.chatzy?.state?.replaceAll("_", " ") ?? "Awaiting setup"}</strong><small>{status()?.chatzy?.alias ?? "Configure a room to get started"}<Show when={status()?.chatzy?.nextKeepaliveAt}><br />Next keep-alive: {time(status()?.chatzy?.nextKeepaliveAt)}</Show></small></div>
        <div class="stat"><span class="stat-label">IN THE ROOM</span><strong>{status()?.chatzy?.online.length ?? 0}<span class="unit"> online</span></strong><small>{status()?.chatzy?.online.join(", ") || "No visitor data yet"}</small></div>
        <div class="stat"><span class="stat-label">DISCORD WEBHOOK</span><strong>{status()?.discord?.lastError ? "Delivery failed" : status()?.discord?.lastSuccessAt ? "Delivered" : "Waiting"}</strong><small>{status()?.discord?.lastError ?? `Last delivery: ${time(status()?.discord?.lastSuccessAt)}`}</small></div>
      </section>
      <section class="toolbar"><div><b>Browser controls</b><span>Saved configuration: {status()?.configDir ?? "/config"}</span></div><div class="actions"><button class="secondary" disabled={busy() || !status()?.chatzy} onClick={() => void action(async () => { await api("reload", "POST", {}); setMessage("Browser reloaded."); })}>Reload page</button><button class="secondary" disabled={busy() || !status()?.configured} onClick={() => void action(async () => { await api("reconnect", "POST", {}); setMessage("Reconnect started."); })}>Reconnect</button></div></section>
      <Show when={loaded()} fallback={<p class="loading">Loading your control room…</p>}>
        <Show when={!status()?.configured}><div class="notice">Welcome! Set the Chatzy room URL and Discord webhook, then save to start the bot.</div></Show>
        <div class="settings-layout">
          <nav aria-label="Settings sections"><span class="eyebrow">SETTINGS</span><For each={groups()}>{(g) => <a href={`#${g.replaceAll(" ", "-")}`}>{g}<span>→</span></a>}</For><a href="#custom-commands">Custom commands<span>→</span></a><p>Secrets stay on the server. Leave a saved password blank to keep it.</p></nav>
          <div class="panels"><form onSubmit={(e) => { e.preventDefault(); void saveSettings(); }}>
            <For each={groups()}>{(g) => <section class="panel" id={g.replaceAll(" ", "-")}><div class="panel-heading"><h3>{g}</h3><span>{fields().filter((f) => f.group === g).length} settings</span></div><div class="field-grid">
              <For each={fields().filter((f) => f.group === g)}>{(f) => <div class="field" classList={{ toggle: f.type === "checkbox" }}>
                <Show when={f.type === "checkbox"} fallback={<>
                  <label for={f.key}>{f.label}</label>
                  <Show when={f.type === "select"} fallback={<input id={f.key} type={f.type} value={env()[f.key] ?? ""} min={f.min} max={f.max} step={f.type === "number" ? "1" : undefined} autocomplete={f.type === "password" ? "new-password" : "off"} disabled={busy() || clearSecrets().has(f.key)} placeholder={secrets()[f.key] ? "Saved · leave blank to keep" : ""} onInput={(e) => change(f.key, e.currentTarget.value)} />}>
                    <select id={f.key} value={env()[f.key]} onChange={(e) => change(f.key, e.currentTarget.value)} disabled={busy()}><For each={f.options}>{(o) => <option value={o}>{o}</option>}</For></select>
                  </Show>
                  <Show when={f.type === "password" && secrets()[f.key]}><label class="clear-secret"><input type="checkbox" checked={clearSecrets().has(f.key)} disabled={busy()} onChange={(e) => setClearSecrets((v) => { const next = new Set(v); e.currentTarget.checked ? next.add(f.key) : next.delete(f.key); return next; })} />Clear saved value</label></Show>
                </>}>
                  <label for={f.key}><span>{f.label}</span><input id={f.key} type="checkbox" checked={env()[f.key] === "true"} disabled={busy()} onChange={(e) => change(f.key, String(e.currentTarget.checked))} /></label>
                </Show>
                <Show when={f.help}><small>{f.help}</small></Show>
              </div>}</For>
            </div></section>}</For>
            <div class="save-bar"><span>{dirty() ? "You have unsaved changes" : "Settings are up to date"}<small>Saving settings restarts the bot's browser session.</small></span><button type="submit" disabled={busy() || !dirty()}>{busy() ? "Applying…" : "Save & apply"}</button></div>
          </form>
          <CommandsEditor prefix={original().COMMAND_PREFIX ?? "!"} busy={busy()} load={() => api<RandomSelector[]>("commands")} save={(commands) => api<RandomSelector[]>("commands", "PUT", commands)} action={action} onDirty={setCommandsDirty} onMessage={setMessage} />
          </div>
        </div>
      </Show>
    </main><footer>Chatzy Bot <span>·</span> Small footprint. One-way connection. Your settings.</footer>
  </div>;
}

render(() => <App />, document.getElementById("root")!);
