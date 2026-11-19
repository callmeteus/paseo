import { useMemo } from "react";
import { ProjectEditSheet } from "@/components/project-edit-sheet";
import { useProjects } from "@/hooks/use-projects";
import {
  closeEditWorkspace,
  useEditWorkspaceRequest,
  type EditWorkspaceRequest,
} from "@/projects/edit-workspace-store";
import type { ProjectEditFormSnapshot } from "@/projects/edit-form";
import { createProjectIconTarget } from "@/projects/icon-target";
import { useProjectIcons } from "@/projects/icons";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { getProjectHostEntry } from "@/utils/projects";

/**
 * Editing a workspace means editing the project behind it: the name and the icon
 * belong to the project, so every workspace under it shows the same pair. The
 * sheet is the same one the project settings screen opens.
 */
export function EditWorkspaceSheetHost() {
  const request = useEditWorkspaceRequest();
  if (!request) return null;
  return (
    <EditWorkspaceSheet key={`${request.serverId}:${request.projectViewKey}`} request={request} />
  );
}

function EditWorkspaceSheet({ request }: { request: EditWorkspaceRequest }) {
  const { projects } = useProjects();
  const project = useMemo(
    () => projects.find((entry) => entry.viewKey === request.projectViewKey),
    [projects, request.projectViewKey],
  );
  const host = useMemo(
    () => getProjectHostEntry(project, request.serverId),
    [project, request.serverId],
  );
  const client = useHostRuntimeClient(request.serverId);
  const supportsCustomIcon = useHostFeature(request.serverId, "projectCustomIcon");
  const iconTargets = useMemo(() => {
    if (!project || !host) return [];
    const target = createProjectIconTarget({
      projectViewKey: project.viewKey,
      placement: { ...host, iconWorkingDir: host.repoRoot },
    });
    return target ? [target] : [];
  }, [host, project]);
  const icons = useProjectIcons({ projects: iconTargets });
  const iconDataUri = project ? (icons.get(project.viewKey) ?? null) : null;
  const snapshot = useMemo<ProjectEditFormSnapshot | null>(() => {
    if (!host) return null;
    return {
      projectName: host.projectName,
      projectCustomName: host.projectCustomName,
      hasCustomIcon: host.customIconRevision != null,
      currentIconDataUri: iconDataUri,
    };
  }, [host, iconDataUri]);

  if (!project || !host || !client || !snapshot) return null;
  return (
    <ProjectEditSheet
      visible
      onClose={closeEditWorkspace}
      serverId={host.serverId}
      projectId={host.projectId}
      projectViewKey={project.viewKey}
      client={client}
      supportsCustomIcon={supportsCustomIcon}
      snapshot={snapshot}
    />
  );
}
