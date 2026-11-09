import type { UserComposerAttachment } from "@/attachments/types";
import type { ComposerTextSource } from "@/composer/text-source";
import type { AttachmentUpdater } from "@/composer/draft/input-draft";
import type { UserMessageImageAttachment } from "@/types/stream";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { buildRewindComposerAttachments, mergeRewindAttachments } from "./rewind-attachments";

export interface RewindComposerRestoreInput {
  text: string;
  images?: readonly UserMessageImageAttachment[];
  attachments?: readonly AgentAttachment[];
}

interface RewindComposerRestoreContextValue {
  completeRewind: (input: RewindComposerRestoreInput) => void;
}

interface RewindComposerRestoreProviderProps {
  textSource: ComposerTextSource;
  setText: (text: string) => void;
  attachments: readonly UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  onRewindComplete: () => void;
  children: ReactNode;
}

const RewindComposerRestoreContext = createContext<RewindComposerRestoreContextValue | null>(null);

export function restoreComposerTextIfEmpty(input: {
  currentText: string;
  rewoundText: string;
}): string {
  if (input.currentText.length > 0) {
    return input.currentText;
  }
  return input.rewoundText;
}

/** A draft the user already started wins, text and attachments alike. */
export function shouldRestoreRewindAttachments(input: {
  currentText: string;
  currentAttachments: readonly UserComposerAttachment[];
}): boolean {
  return input.currentText.length === 0 && input.currentAttachments.length === 0;
}

export function RewindComposerRestoreProvider({
  textSource,
  setText,
  attachments,
  setAttachments,
  onRewindComplete,
  children,
}: RewindComposerRestoreProviderProps) {
  const completeRewind = useCallback(
    (input: RewindComposerRestoreInput) => {
      const currentText = textSource.getSnapshot();
      const nextText = restoreComposerTextIfEmpty({
        currentText: currentText,
        rewoundText: input.text,
      });
      if (nextText !== currentText) {
        setText(nextText);
      }
      // A draft the user already started wins, text and attachments alike.
      if (shouldRestoreRewindAttachments({ currentText, currentAttachments: attachments })) {
        const restored = buildRewindComposerAttachments({
          images: input.images ?? [],
          attachments: input.attachments ?? [],
        });
        if (restored.length > 0) {
          setAttachments((current) => mergeRewindAttachments(current, restored));
        }
      }
      onRewindComplete();
    },
    [attachments, onRewindComplete, setAttachments, setText, textSource],
  );

  const value = useMemo(() => ({ completeRewind }), [completeRewind]);

  return (
    <RewindComposerRestoreContext.Provider value={value}>
      {children}
    </RewindComposerRestoreContext.Provider>
  );
}

export function useRewindComposerRestore(): RewindComposerRestoreContextValue | null {
  return useContext(RewindComposerRestoreContext);
}
