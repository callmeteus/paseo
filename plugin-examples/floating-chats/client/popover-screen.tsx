import { useAgent, useWorkspace, type PluginScreenProps } from "@getpaseo/plugin/client";
import { StyleSheet, View } from "react-native";
import { useMemo } from "react";

import { AwaitingInputCard } from "./awaiting-input-card";
import { ChatTooltip } from "./chat-tooltip";
import { MessagePreview } from "./message-preview";
import { useNativeSkin } from "./native-skin";

/**
 * Conteúdo da janela do popover, escolhido pelo parâmetro `kind`.
 *
 * @param props Props da screen com `kind` e `agentId` na URL.
 * @returns O cartão correspondente ao tipo de popover.
 */
export function PopoverScreen({ params, host }: PluginScreenProps) {
  const skin = useNativeSkin();
  const agentId = params.agentId ?? "";
  const kind = params.kind ?? "tooltip";
  const agent = useAgent(agentId);
  const workspace = useWorkspace(agent?.workspace ?? "");

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          backgroundColor: "transparent",
        },
      }),
    [],
  );

  if (!agent) return <View style={styles.root} />;

  const title = agent.title ?? workspace?.title ?? workspace?.name ?? agent.id;
  let content;
  if (kind === "awaitingInput") {
    content = (
      <AwaitingInputCard title={title} detail={workspace?.branch ?? host.label} skin={skin} />
    );
  } else if (kind === "message") {
    content = (
      <MessagePreview
        title={title}
        branch={workspace?.branch ?? null}
        repo={workspace?.projectDisplayName ?? "sem repo"}
        preview=""
        skin={skin}
      />
    );
  } else {
    content = (
      <ChatTooltip agent={agent} workspace={workspace} hostLabel={host.label} skin={skin} />
    );
  }

  return <View style={styles.root}>{content}</View>;
}
