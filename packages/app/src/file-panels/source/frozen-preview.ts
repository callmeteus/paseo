/**
 * The Preview shows the file as it was when the view opened. An agent that
 * rewrites the file would otherwise move the document under the reader, so disk
 * changes wait until the view is left and opened again.
 */
export interface FrozenPreview {
  text: string;
}

export function nextFrozenPreview(
  current: FrozenPreview | null,
  input: { active: boolean; text: string | undefined },
): FrozenPreview | null {
  if (!input.active || input.text === undefined) return null;
  if (current) return current;
  return { text: input.text };
}
