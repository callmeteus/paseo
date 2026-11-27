const PASEO_NODE_ENV = "PASEO_NODE_ENV";
export const PASEO_CLOSE_INHERITED_FDS_UNDER = "PASEO_CLOSE_INHERITED_FDS_UNDER";

export interface NodeEntrypointSpec {
  entryPath: string;
  execArgv: string[];
}

export interface NodeEntrypointInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export type NodeEntrypointArgvMode = "bare" | "node-script";

interface CreateNodeEntrypointInvocationInput {
  execPath: string;
  isPackaged: boolean;
  packagedRunnerPath: string | null;
  entrypoint: NodeEntrypointSpec;
  argvMode: NodeEntrypointArgvMode;
  args: string[];
  baseEnv: NodeJS.ProcessEnv;
  inheritedFdPathPrefix?: string;
}

export function createElectronNodeEnv(
  baseEnv: NodeJS.ProcessEnv,
  options?: { isPackaged?: boolean; inheritedFdPathPrefix?: string },
): NodeJS.ProcessEnv {
  const inheritedFdPathPrefix = options?.inheritedFdPathPrefix;
  return {
    ...baseEnv,
    ELECTRON_RUN_AS_NODE: "1",
    [PASEO_NODE_ENV]: options?.isPackaged === true ? "production" : "development",
    ...(inheritedFdPathPrefix ? { [PASEO_CLOSE_INHERITED_FDS_UNDER]: inheritedFdPathPrefix } : {}),
  };
}

export function createNodeEntrypointInvocation(
  input: CreateNodeEntrypointInvocationInput,
): NodeEntrypointInvocation {
  const env = createElectronNodeEnv(input.baseEnv, {
    isPackaged: input.isPackaged,
    inheritedFdPathPrefix: input.inheritedFdPathPrefix,
  });

  if (input.isPackaged) {
    if (!input.packagedRunnerPath) {
      throw new Error("Packaged node entrypoint runner is required for desktop launches.");
    }

    return {
      command: input.execPath,
      args: [
        "--disable-warning=DEP0040",
        input.packagedRunnerPath,
        input.argvMode,
        input.entrypoint.entryPath,
        ...input.args,
      ],
      env,
    };
  }

  return {
    command: input.execPath,
    args: [...input.entrypoint.execArgv, input.entrypoint.entryPath, ...input.args],
    env,
  };
}
