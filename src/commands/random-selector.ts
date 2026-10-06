import { z } from "zod";
import type { ChatzyCommand } from "./registry.ts";
export { parseSelectorLines } from "./selector-lines.ts";

export const randomSelectorSchema = z.object({
  id: z.string().min(1).max(100),
  category: z.literal("random-selector"),
  name: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{0,31}$/, "Command name must start with a letter and contain only letters, numbers or underscores (no prefix)"),
  description: z.string().trim().max(200),
  enabled: z.boolean(),
  cooldownMs: z.number().int().min(0).max(3_600_000),
  avoidRepeats: z.boolean(),
  values: z.array(z.string().trim().min(1).max(3900).regex(/^[^\r\n]+$/, "Each value must be a single line")).max(1000),
}).strict();

export type RandomSelector = z.infer<typeof randomSelectorSchema>;

export const customCommandsSchema = z.array(randomSelectorSchema).max(100).superRefine((commands, ctx) => {
  const names = new Set<string>();
  const ids = new Set<string>();
  commands.forEach((command, index) => {
    if (["help", "relay"].includes(command.name)) ctx.addIssue({ code: "custom", path: [index, "name"], message: "help and relay are reserved built-in commands" });
    if (names.has(command.name)) ctx.addIssue({ code: "custom", path: [index, "name"], message: "Command names must be unique (case-insensitive)" });
    if (ids.has(command.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: "Command IDs must be unique" });
    names.add(command.name);
    ids.add(command.id);
  });
});

/** Uniform selection, excluding the previous value when there are alternatives. */
export function createRandomPicker(source: () => string[], random = Math.random, avoidRepeats: () => boolean = () => true): () => string | undefined {
  let last: string | undefined;
  return () => {
    const values = source();
    if (!values.length) return undefined;
    const alternatives = avoidRepeats() ? values.filter((value) => value !== last) : values;
    const pool = alternatives.length ? alternatives : values;
    const selected = pool[Math.floor(random() * pool.length)];
    last = selected;
    return selected;
  };
}

/** Keeps selection state per command while reading the saved list live. */
export function randomSelectorCommands(source: () => RandomSelector[], prefix: string, random = Math.random): () => ChatzyCommand[] {
  const pickers = new Map<string, { config: RandomSelector; pick: () => string | undefined }>();
  return () => {
    const configs = source();
    const ids = new Set(configs.map((config) => config.id));
    for (const id of pickers.keys()) if (!ids.has(id)) pickers.delete(id);
    return configs.filter((config) => config.enabled).map((config) => {
      let entry = pickers.get(config.id);
      if (!entry) {
        const state = { config, pick: (): string | undefined => undefined };
        state.pick = createRandomPicker(() => state.config.values, random, () => state.config.avoidRepeats);
        pickers.set(config.id, state);
        entry = state;
      }
      entry.config = config;
      const state = entry;
      return {
        name: config.name,
        usage: `${prefix}${config.name}`,
        description: config.description || "select a random response",
        cooldownMs: config.cooldownMs,
        async run({ reply }) {
          await reply(state.pick() ?? `No values configured for ${prefix}${state.config.name}.`);
        },
      };
    });
  };
}
