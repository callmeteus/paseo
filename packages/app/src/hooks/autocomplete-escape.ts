import type { SlashCommandRange } from "@/utils/agent-command-autocomplete";
import type { FileMentionRange } from "@/utils/file-mention-autocomplete";

export type AutocompleteMode = "command" | "file" | null;

export interface AutocompleteEscapeArgs {
  mode: AutocompleteMode;
  slashCommand: SlashCommandRange | null;
  fileMention: FileMentionRange | null;
  clearInput: () => void;
  dismissCommand: (start: number) => void;
  dismissMention: (start: number) => void;
}

/**
 * Escape belongs to the picker, not the global shortcut, while a token is open.
 * It only dismisses the picker; the typed text always stays intact. Clearing the
 * draft here would wipe everything the user had already written.
 */
export function resolveAutocompleteEscape(args: AutocompleteEscapeArgs): (() => void) | undefined {
  const command = args.slashCommand;
  if (args.mode === "command" && command) {
    return () => args.dismissCommand(command.start);
  }
  const mention = args.fileMention;
  if (args.mode === "file" && mention) {
    return () => args.dismissMention(mention.start);
  }
  return undefined;
}
