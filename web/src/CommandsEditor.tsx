import { createEffect, createSignal, For, Show, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { RandomSelector } from "../../src/commands/random-selector";
import { parseSelectorLines } from "../../src/commands/selector-lines";

type DraftCommand = Omit<RandomSelector, "values" | "cooldownMs"> & { lines: string; cooldown: string };

interface Props {
  prefix: string;
  busy: boolean;
  load(): Promise<RandomSelector[]>;
  save(commands: RandomSelector[]): Promise<RandomSelector[]>;
  action(fn: () => Promise<void>): Promise<void>;
  onDirty(dirty: boolean): void;
  onMessage(message: string): void;
}

export function CommandsEditor(props: Props) {
  const [draft, setDraft] = createStore<DraftCommand[]>([]);
  const [original, setOriginal] = createSignal("");
  const [loaded, setLoaded] = createSignal(false);
  const [loadError, setLoadError] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [expanded, setExpanded] = createSignal(new Set<string>());
  const dirty = () => loaded() && JSON.stringify(draft) !== original();
  const apply = (commands: RandomSelector[]) => {
    const values = commands.map(({ values, cooldownMs, ...command }) => ({ ...command, lines: values.join("\n"), cooldown: String(cooldownMs) }));
    setDraft(reconcile(values));
    setOriginal(JSON.stringify(values));
    setLoaded(true);
  };
  createEffect(() => props.onDirty(dirty()));
  onMount(async () => {
    try { apply(await props.load()); }
    catch (e) { setLoadError((e as Error).message); }
  });

  function addCommand() {
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    setFilter("");
    setExpanded((v) => new Set([...v, id]));
    setDraft(draft.length, { id, name: "", category: "random-selector", enabled: true, description: "", cooldown: "5000", avoidRepeats: true, lines: "" });
  }

  const save = () => props.action(async () => {
    const commands: RandomSelector[] = draft.map(({ lines, cooldown, ...command }) => ({
      ...command, values: parseSelectorLines(lines), cooldownMs: Number(cooldown),
    }));
    apply(await props.save(commands));
    props.onMessage("Custom commands saved. Changes are available immediately without reconnecting.");
  });

  return <section class="panel custom-commands" id="custom-commands">
    <div class="panel-heading"><div><h3>Custom commands</h3><p>Make your own shortcuts for jokes, links, and anything worth sharing.</p></div><span class="pill">{draft.length} commands</span></div>
    <div class="selector-category"><span class="eyebrow">RANDOM SELECTOR</span><p>One line is one response. The bot picks a line at random and sends it into Chatzy.</p></div>
    <Show when={loadError()}><div role="alert" class="notice error">{loadError()}</div></Show>
    <Show when={loaded()} fallback={<p class="loading">Loading custom commands…</p>}>
      <div class="command-tools"><input aria-label="Search commands" placeholder="Find a command…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} /><button class="secondary" disabled={props.busy} onClick={addCommand}>+ Add random selector</button></div>
      <Show when={draft.length === 0}><p class="empty-commands">No custom commands yet. Add a random selector to get started.</p></Show>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div class="command-list"><For each={draft}>{(command, index) => <Show when={`${command.name} ${command.description}`.toLowerCase().includes(filter().toLowerCase())}>
          <details class="command-card" open={expanded().has(command.id)} onToggle={(e) => {
            const open = e.currentTarget.open;
            if (open !== expanded().has(command.id)) setExpanded((v) => { const next = new Set(v); open ? next.add(command.id) : next.delete(command.id); return next; });
          }}>
            <summary><div><strong>{props.prefix}{command.name || "new_command"}</strong><small>{parseSelectorLines(command.lines).length} values · {command.enabled ? "enabled" : "disabled"}</small></div><span class="category-badge">Random selector <span>⌄</span></span></summary>
            <div class="command-body">
              <div class="field-grid">
                <div class="field"><label for={`name-${command.id}`}>Command name</label><div class="prefix-input"><span>{props.prefix}</span><input id={`name-${command.id}`} aria-label={`Command name ${command.id}`} value={command.name} required pattern="[a-zA-Z][a-zA-Z0-9_]{0,31}" maxlength={32} placeholder="jenna" disabled={props.busy} onInput={(e) => setDraft(index(), "name", e.currentTarget.value)} /></div><small>Name only, without the prefix. Names are case-insensitive; help and relay are reserved.</small></div>
                <div class="field"><label for={`category-${command.id}`}>Category</label><select id={`category-${command.id}`} disabled={props.busy}><option value="random-selector">Random selector</option></select></div>
                <div class="field"><label for={`description-${command.id}`}>Description</label><input id={`description-${command.id}`} value={command.description} maxlength={200} placeholder="Shown in the help command" disabled={props.busy} onInput={(e) => setDraft(index(), "description", e.currentTarget.value)} /></div>
                <div class="field"><label for={`cooldown-${command.id}`}>Per-user cooldown (ms)</label><input id={`cooldown-${command.id}`} type="number" value={command.cooldown} min={0} max={3600000} step={1} required disabled={props.busy} onInput={(e) => setDraft(index(), "cooldown", e.currentTarget.value)} /></div>
                <div class="field toggle"><label for={`enabled-${command.id}`}>Enabled<input id={`enabled-${command.id}`} type="checkbox" checked={command.enabled} disabled={props.busy} onChange={(e) => setDraft(index(), "enabled", e.currentTarget.checked)} /></label></div>
                <div class="field toggle"><label for={`repeat-${command.id}`}>Avoid immediate repeats<input id={`repeat-${command.id}`} type="checkbox" checked={command.avoidRepeats} disabled={props.busy} onChange={(e) => setDraft(index(), "avoidRepeats", e.currentTarget.checked)} /></label></div>
              </div>
              <div class="field response-lines"><label for={`values-${command.id}`}>Responses (one per line)</label><textarea id={`values-${command.id}`} rows={8} spellcheck={false} value={command.lines} placeholder={"A joke or message\nhttps://example.com/image-one.jpg\nhttps://example.com/image-two.gif"} disabled={props.busy} onInput={(e) => setDraft(index(), "lines", e.currentTarget.value)} /><small>Blank lines are ignored. Text and image URLs are sent as-is; whether an image embeds depends on Chatzy. Maximum 1,000 values, 3,900 characters per line.</small></div>
              <div class="command-card-footer"><small>Usage: <code>{props.prefix}{command.name || "new_command"}</code><Show when={!parseSelectorLines(command.lines).length}> · Add responses before using this command.</Show></small><button type="button" class="remove-command" disabled={props.busy} onClick={() => setDraft(reconcile(draft.filter((_, i) => i !== index())))}>Remove command</button></div>
            </div>
          </details>
        </Show>}</For></div>
        <div class="command-save"><span>{dirty() ? "You have unsaved command changes" : "Commands are up to date"}<small>Saving commands does not restart the browser session.</small></span><button type="submit" disabled={props.busy || !dirty()}>Save commands</button></div>
      </form>
    </Show>
  </section>;
}
