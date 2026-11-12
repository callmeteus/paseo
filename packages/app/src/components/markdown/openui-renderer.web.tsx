import { useCallback } from "react";
import { Renderer } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui";
import type { ActionEvent } from "@openuidev/lang-core";
import "@openuidev/react-ui/styles/index.css";

export interface OpenUIRendererProps {
  code: string;
  streaming?: boolean;
  /** Send a conversational button action back to the agent. */
  onAction?: (message: string) => void;
}

/** Renders an assistant message written in OpenUI Lang with the official renderer. */
export function OpenUIRenderer({ code, streaming = false, onAction }: OpenUIRendererProps) {
  const handleAction = useCallback(
    (event: ActionEvent) => {
      if (event.type === "open_url") {
        const url = typeof event.params?.url === "string" ? event.params.url : null;
        if (url && typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      const message = event.humanFriendlyMessage?.trim();
      if (message) onAction?.(message);
    },
    [onAction],
  );

  return (
    <Renderer
      response={code}
      library={openuiLibrary}
      isStreaming={streaming}
      onAction={handleAction}
    />
  );
}
