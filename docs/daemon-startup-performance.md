# Daemon startup performance

Measured on Windows (x64, 32 logical cores, 64 GB RAM) with daemon 0.13.1 on 2026-11-19. The machine had 18.2 GB free at measurement time.

## What the numbers say

The daemon reaches "listening" quickly. It becomes fully usable much later. The gap is where the CPU goes.

| Phase                                   | Elapsed since `bootstrapStart`                             |
| --------------------------------------- | ---------------------------------------------------------- |
| Bootstrap complete                      | 179 ms on this run (5 runs: 179 to 370 ms, average 268 ms) |
| Server listening                        | 543 ms                                                     |
| Workspace reconciliation                | 2.6 s to 2.9 s                                             |
| Speech provider reconciliation complete | 4.05 s                                                     |
| Managed process ledger reconciled       | 8.75 s                                                     |
| First provider snapshot failure         | 4.8 s, then repeats through 07:44:19                       |

The bootstrap stages themselves are cheap: agent storage 75 ms (average 151 ms), workspace registries 85 ms (average 164 ms), schedule service 165 ms (average 248 ms).

## Live process cost

Sampled over 5 seconds, then averaged over each process lifetime:

| Process           | Average CPU of one core       | Working set |
| ----------------- | ----------------------------- | ----------- |
| `daemon-worker`   | 33.3% (45.8 s CPU in 2.3 min) | 365 MB      |
| Electron renderer | 11.1% (26.3 s CPU in 4 min)   | 427 MB      |
| Electron main     | 2.2%                          | 177 MB      |
| GPU process       | 2.8%                          | 157 MB      |

Total Paseo working set was about 1.4 GB. The renderer number includes this chat session, so treat it as an upper bound for idle UI.

The daemon's own metrics put RSS at 377.6 MiB (329.6 MiB in a later snapshot), with 204.2 MiB heap total and 159.3 MiB heap used. It held 19 active WebSocket connections, 3 agents and 845 timeline items, with one agent holding 672 items.

A second sample taken 38 minutes into a fresh daemon shows how the cost changes with load. The daemon had grown to 770 MB working set (747 MB private) and held 18.4% of one core. Its own metrics reported 1,012 MiB RSS, 614.5 MiB heap total, 537.6 MiB heap used and 133.2 MiB external. Agent count had gone from 3 to 13, and timeline items from 845 to 21,737, with one agent holding 6,628 items. Memory growth tracks the accumulated timelines, not the number of open connections.

## Why startup is expensive

### Full file inventory and `fs.stat` classification

The file observer runs an awaited full inventory at startup. On this machine it held 16 observations, 16 native handles and 12,018 tracked files across 33 watched Git directories and 129 workspace records.

The existing benchmark (`npm run measure:file-observer --workspace=@getpaseo/server`) reproduces the cost in isolation. Fixture: 500 directories, 1,000 tracked files, 2,000 ignored files, one root, Node 24, win32.

| Metric                 | Result                        |
| ---------------------- | ----------------------------- |
| Setup (full inventory) | 587.5 ms                      |
| Startup events emitted | 604                           |
| CPU, user              | 1,266 ms                      |
| CPU, system            | 10,656 ms (89.4% of CPU time) |
| RSS delta              | 5.6 MiB                       |
| Max reconciliation     | 586 ms                        |
| Event loop delay p99   | 16.3 ms                       |

Almost all CPU is system time, not JavaScript. It comes from filesystem calls during inventory and classification, which share the libuv threadpool with the rest of the daemon. The production tree has roughly four times the fixture's file count, so the same work scales with the number of files under observation, not with agent activity. This is the main reason startup dominates CPU.

### Reconciliation runs immediately after bootstrap

`bootstrap.ts` fires `workspaceReconciliation.reconcileNow()` as soon as registrations are ready. It ran 48 reconciliations (29 full, 18 scoped) with one taking 17.6 seconds. It failed or was skipped 21 times with "Skipped workspace reconciliation after Git read failed", then retried. That is repeated work with no user-visible result.

### Provider and forge probes fail and retry

The log shows 13 "Failed to refresh provider snapshot" entries and 31 "Failed to run forge PR status self-heal refresh" entries. Each forge failure builds and sends a batched GraphQL query covering seven repositories, then fails because a repository is missing from the batch response. The full error text is written to `daemon.log` every time. ACP provider probes spawn real processes that can take 5 to 15 seconds each. These loops burn CPU and disk I/O while the user waits.

## Spawned runtime processes

The daemon also leaves agent runtimes behind. A sample found 15 `opencode serve --hostname 127.0.0.1 --port 0` processes started through the daemon node runner. Together they used 5,115 MB working set and 7,878 MB private bytes, with 170 s of accumulated CPU, while sitting idle. There were also 18 `browse` MCP pairs (a `node cli.mjs mcp` process and a `browse.exe mcp` child each). The `opencode` processes have `cmd.exe` wrappers as direct parents, and all of those wrappers trace back to the daemon node runner, so they are Paseo children rather than unrelated user processes.

These runtimes outlive the turn that created them. That makes them a larger source of RAM growth than the daemon heap itself, and it explains why a machine can look idle while memory stays high. Limiting timeline items (R-013) will not fix this on its own. Reaping idle and orphaned runtimes is tracked as R-014 in [ROADMAP.md](../ROADMAP.md).

## What is not the problem

Steady state is mostly idle when few agents are active. Over the 5 second sample, no process exceeded 6.8% of one core. Event loop delay stayed under 45 ms. Once initialization settles, CPU from startup work drops sharply. With 13 agents and 3 active foreground turns, the daemon held 18.4% of one core and event loop delay peaked at 205.7 ms, so agent streaming becomes the steady cost. The problem at startup is the burst and the retries that keep parts of it alive; later the cost follows the number of active agents and the size of their timelines.

## Measurement commands

```bash
npm run measure:file-observer --workspace=@getpaseo/server
```

Daemon self-reporting is in `~/.paseo/daemon.log`: the `elapsed` field on bootstrap lines and the `ws_runtime_metrics` message carry the phase timings, memory and observer counters used above.

## Missing metric

There is no single number for "how long until Paseo is actually ready". Bootstrap logs carry phase elapsed values, but nothing records time to listening, time to full initialization, or the CPU and memory spent getting there. See R-012 in [ROADMAP.md](../ROADMAP.md).

The later sample also shows memory growing with accumulated timeline items. Limiting those in memory, with active chats prioritized, is tracked as R-013 in [ROADMAP.md](../ROADMAP.md).
