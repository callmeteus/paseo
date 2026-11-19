import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import {
  ComposerEditingScope,
  WorkspaceComposerEditingSessionsProvider,
} from "@/composer/editing-session";
import { NewAgentScreen } from "@/screens/new-agent-screen";
import { buildNewAgentDraftKey } from "@/stores/draft-keys";

/** Full-screen new-agent drafts get their own editing-session home, like /new. */
const NEW_AGENT_SESSIONS_KEY = "new-agent";

export default function NewAgentRoute() {
  const params = useLocalSearchParams<{
    serverId?: string;
    workspaceId?: string;
    draftId?: string;
  }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const draftId = typeof params.draftId === "string" ? params.draftId : undefined;
  const draftKey = buildNewAgentDraftKey(draftId);
  const sessionTabIds = useMemo(() => [draftKey], [draftKey]);

  return (
    <HostRouteBootstrapBoundary>
      <WorkspaceComposerEditingSessionsProvider
        workspaceKey={NEW_AGENT_SESSIONS_KEY}
        tabIds={sessionTabIds}
      >
        <ComposerEditingScope tabId={draftKey} targetKey={draftKey}>
          <NewAgentScreen serverId={serverId} workspaceId={workspaceId} draftId={draftId} />
        </ComposerEditingScope>
      </WorkspaceComposerEditingSessionsProvider>
    </HostRouteBootstrapBoundary>
  );
}
