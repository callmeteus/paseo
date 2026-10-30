import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { CursorImportSheet } from "@/components/cursor-import-sheet";
import { useHostChooser } from "@/hosts/host-chooser";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { navigateToAgent } from "@/utils/navigate-to-agent";

interface UseCursorImportOptions {
  serverId?: string;
}

interface UseCursorImportResult {
  open: () => void;
  sheet: ReactNode;
}

/**
 * Opens the Cursor chat importer for a host. Imported chats are read-only
 * mirrors; the sheet navigates to the first imported agent when it finishes.
 */
export function useCursorImport({ serverId }: UseCursorImportOptions = {}): UseCursorImportResult {
  const { t } = useTranslation();
  const chooseHost = useHostChooser();
  const [importServerId, setImportServerId] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const client = useHostRuntimeClient(importServerId ?? "");

  const openForHost = useCallback((chosenServerId: string) => {
    setImportServerId(chosenServerId);
    setIsSheetOpen(true);
  }, []);

  const open = useCallback(() => {
    if (serverId) {
      openForHost(serverId);
      return;
    }
    chooseHost({
      title: t("importSession.chooseHostTitle"),
      onChooseHost: openForHost,
    });
  }, [chooseHost, openForHost, serverId, t]);

  const close = useCallback(() => setIsSheetOpen(false), []);

  const handleImported = useCallback(
    (agentId: string) => {
      if (!importServerId) return;
      navigateToAgent({ serverId: importServerId, agentId });
    },
    [importServerId],
  );

  return {
    open,
    sheet: (
      <CursorImportSheet
        visible={isSheetOpen}
        client={client}
        onClose={close}
        onImported={handleImported}
      />
    ),
  };
}
