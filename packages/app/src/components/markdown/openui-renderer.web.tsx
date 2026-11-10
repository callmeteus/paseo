import { Renderer } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui";
import "@openuidev/react-ui/styles/index.css";

export interface OpenUIRendererProps {
  code: string;
  streaming?: boolean;
}

/** Renders an assistant message written in OpenUI Lang with the official renderer. */
export function OpenUIRenderer({ code, streaming = false }: OpenUIRendererProps) {
  return <Renderer response={code} library={openuiLibrary} isStreaming={streaming} />;
}
