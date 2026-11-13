# Remote access

Remote access lets MCP tools act on a connected host: search its chats, read and search files, write files, and run commands. It is off by default in both directions.

## Two directions

| Direction  | Lives on                  | Answers                                                      |
| ---------- | ------------------------- | ------------------------------------------------------------ |
| `outbound` | The host whose agents act | Which hosts may my agents reach, and what may they do there? |
| `inbound`  | The host being acted on   | Which origins may act here, and what may they do?            |

A call needs both sides: the caller's `outbound` policy and the destination's `inbound` policy. The destination is the authority. The caller also narrows the routed permissions (`workspace.read` for reads, `+workspace.write` for writes and commands), so a bug in the tool layer cannot exceed what the policy already allowed.

The gate applies only to MCP-origin routes (`producer.sourceId = "mcp"`). Direct app, CLI, and SDK connections keep their ordinary authority.

## Configuration

```json
{
  "daemon": {
    "remoteAccess": {
      "outbound": {
        "enabled": false,
        "peers": [],
        "chats": false,
        "agents": false,
        "files": "off",
        "commands": {
          "mode": "any",
          "allowlist": [],
          "timeoutMs": 120000,
          "maxOutputBytes": 1048576
        },
        "restrictToWorkspaces": true
      },
      "inbound": {
        "enabled": false,
        "peers": [],
        "chats": false,
        "agents": false,
        "files": "off",
        "commands": {
          "mode": "any",
          "allowlist": [],
          "timeoutMs": 120000,
          "maxOutputBytes": 1048576
        },
        "restrictToWorkspaces": true
      }
    }
  }
}
```

- `peers`: outbound uses destination server IDs; inbound uses origin server IDs. Empty means nobody, even with `enabled: true`.
- `files`: `"off"`, `"read"`, or `"write"` (`"write"` implies read).
- `commands.mode`: `"off"`, `"allowlist"`, or `"any"`. `"any"` is the default because the whole direction is already off; turning commands on is the dangerous step. The app asks for confirmation again.
- `shell: true` requires `commands.mode = "any"`.
- `restrictToWorkspaces`: when true, file and command calls must target an active workspace. When false, they may pass any `cwd` the daemon can read.

`paseo daemon config set daemon.remoteAccess...` edits and applies this live. Open a new agent or MCP session to pick up newly added tools.

## Capabilities

| Capability    | MCP tools                                                                        | Inbound requests it gates                                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chats`       | `search_chats` with `serverId` or `allHosts`                                     | `chat.search.request`                                                                                                                                                                                                                      |
| `agents`      | `create_agent`, `send_agent_prompt`, and the agent and workspace lifecycle tools | `create_agent_request`, `agent.create.request`, `send_agent_message_request`, agent control and configuration requests, `workspace.create.request`, `archive_workspace_request`, `workspace.delete.request`, `workspace.setup.run.request` |
| `files.read`  | `list_remote_files`, `read_remote_file`, `search_remote_files`                   | `file_explorer_request`, `fs.file.subscribe.request`, `fs.search.request`                                                                                                                                                                  |
| `files.write` | `write_remote_file`, `edit_remote_file`                                          | `fs.file.write.request`, `fs.entry.*`                                                                                                                                                                                                      |
| `commands`    | `run_remote_command`                                                             | `process.exec.request`, `create_terminal_request`, `terminal_input`, `capture_terminal_request`, `kill_terminal_request`                                                                                                                   |

Remote tools require an explicit `serverId` for another host and exactly one of `workspaceId` or `cwd`. They never run against the local host; use the provider's own file and terminal tools there.

`write_remote_file` reads the current revision and writes against it, and `edit_remote_file` refuses ambiguous replacements unless `replaceAll` is set. A revision conflict returns the latest revision instead of overwriting.

## Delegation is execution

`agents` is the most dangerous capability: a remote agent that may create or prompt agents on this host can run arbitrary work through them, even when `commands` is off. Turning off `commands` is not a sandbox while `agents` is on. To revoke remote control entirely, disable or remove the saved host.

The host link itself authenticates as the owner. A compromised peer can ignore the source marker; the link, not this configuration, is the security boundary.

## Verification

- `npx vitest run src/server/remote-access/policy.test.ts src/server/process-exec/runner.test.ts src/server/file-explorer/search.test.ts --bail=1`
- With everything off, `search_chats` with a `serverId` and every `*_remote_*` tool returns an access error.
- With outbound and inbound enabled for one pair, list, read, write, edit, search, and run a command in a remote workspace.
- A non-MCP routed client keeps its existing access.
