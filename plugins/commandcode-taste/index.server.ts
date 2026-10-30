import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listTasteRpc, previewTasteRpc } from "./shared/rpc.js";
import { DEFAULT_TASTE_PREFERENCES, tastePreferences } from "./shared/settings.js";
import {
  appendTasteBlock,
  composeTasteBlock,
  readTasteLearning,
  readTasteSnapshot,
  shouldInjectTaste,
  type TasteFileRecord,
} from "./server/taste.js";

function fileMetadata(file: TasteFileRecord) {
  return {
    relativePath: file.relativePath,
    path: file.path,
    bytes: file.bytes,
    modifiedAt: file.modifiedAt,
  };
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(tastePreferences);

  const readPreferences = async () => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : DEFAULT_TASTE_PREFERENCES;
  };

  server.handle(listTasteRpc, async (input) => {
    const preferences = await readPreferences();
    const snapshot = await readTasteSnapshot(input.cwd, preferences.includeGlobal);
    const learning = await readTasteLearning(snapshot.projectRoot);
    return {
      projectRoot: snapshot.projectRoot,
      learning,
      project: snapshot.files.filter((file) => file.scope === "project").map(fileMetadata),
      global: snapshot.files.filter((file) => file.scope === "global").map(fileMetadata),
      applyToOtherProviders: preferences.applyToOtherProviders,
      includeGlobal: preferences.includeGlobal,
      maxChars: preferences.maxChars,
    };
  });

  server.handle(previewTasteRpc, async (input) => {
    const preferences = await readPreferences();
    const snapshot = await readTasteSnapshot(input.cwd, preferences.includeGlobal);
    const composed = composeTasteBlock(snapshot.files, preferences.maxChars);
    return {
      block: composed.block,
      files: snapshot.files.map((file) => file.relativePath),
      truncated: composed.truncated,
    };
  });

  const removeHook = server.before("agent.create", async ({ request }) => {
    try {
      const preferences = await readPreferences();
      if (!shouldInjectTaste(request.config.provider, preferences.applyToOtherProviders)) {
        return;
      }
      const snapshot = await readTasteSnapshot(request.config.cwd, preferences.includeGlobal);
      const composed = composeTasteBlock(snapshot.files, preferences.maxChars);
      if (!composed.block) return;
      const systemPrompt = appendTasteBlock(request.config.systemPrompt, composed.block);
      if (systemPrompt === request.config.systemPrompt) return;
      return { ...request, config: { ...request.config, systemPrompt } };
    } catch (error) {
      // A taste hiccup must never block creating a chat.
      console.warn("commandcode-taste: could not apply taste to the new chat", error);
      return;
    }
  });

  return () => removeHook();
}
