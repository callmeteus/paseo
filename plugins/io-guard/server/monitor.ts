import { statfsSync, type Dirent } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import {
  ALERT_ID,
  ALERT_KIND,
  type AlertData,
  type Finding,
  type IoGuardStatus,
} from "../shared/contracts.js";
import { defaultSettings, ioGuardSettings, type IoGuardSettings } from "../shared/settings.js";

const SHELL_PATH = join(".local", "share", "opencode", "shell");
const MAX_TRACKED_FILES = 200;
const BYTES_PER_MB = 1024 ** 2;
const BYTES_PER_GB = 1024 ** 3;

export interface ShellFile {
  path: string;
  size: number;
  mtimeMs: number;
}

interface SizeSample {
  size: number;
  at: number;
}

interface DiskFact {
  drive: string;
  freeGB: number;
  totalGB: number;
}

export function shellRoot(): string {
  return join(homedir(), SHELL_PATH);
}

async function safeStat(filePath: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(filePath);
    return { size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

async function scanShellFiles(root: string): Promise<ShellFile[]> {
  const found: ShellFile[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }

  const inspect = async (filePath: string): Promise<void> => {
    const info = await safeStat(filePath);
    if (info) {
      found.push({ path: filePath, size: info.size, mtimeMs: info.mtimeMs });
    }
  };

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const directory = join(root, entry.name);
      let children: Dirent[];
      try {
        children = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of children) {
        if (child.isFile() && /^sh_.*\.out$/i.test(child.name)) {
          await inspect(join(directory, child.name));
        }
      }
    } else if (entry.isFile() && /^sh_.*\.out$/i.test(entry.name)) {
      await inspect(join(root, entry.name));
    }
  }

  return found.sort((a, b) => b.size - a.size).slice(0, MAX_TRACKED_FILES);
}

function readDisks(drives: string[]): DiskFact[] {
  return drives.map((drive) => {
    try {
      const info = statfsSync(drive);
      return {
        drive,
        freeGB: (info.bavail * info.bsize) / BYTES_PER_GB,
        totalGB: (info.blocks * info.bsize) / BYTES_PER_GB,
      };
    } catch {
      return { drive, freeGB: -1, totalGB: -1 };
    }
  });
}

export function evaluate(
  files: ShellFile[],
  disks: DiskFact[],
  config: IoGuardSettings,
  previous: Map<string, SizeSample>,
  now: number,
): Finding[] {
  const findings: Finding[] = [];
  const nextPrevious = new Map<string, SizeSample>();
  const seen = new Set<string>();

  for (const file of files) {
    seen.add(file.path);
    nextPrevious.set(file.path, { size: file.size, at: now });
    const sizeMB = file.size / BYTES_PER_MB;
    const name = basename(file.path);

    if (sizeMB >= config.fileThresholdMB) {
      findings.push({
        kind: "file-size",
        severity: sizeMB >= config.fileThresholdMB * 2 ? "critical" : "warning",
        title: `Arquivo de shell muito grande: ${name}`,
        detail: `${sizeMB.toFixed(1)} MB em ${file.path}`,
        path: file.path,
        sizeMB,
      });
      continue;
    }

    const old = previous.get(file.path);
    if (old) {
      const deltaMB = (file.size - old.size) / BYTES_PER_MB;
      if (deltaMB >= config.growthThresholdMB) {
        findings.push({
          kind: "file-growth",
          severity: deltaMB >= config.growthThresholdMB * 4 ? "critical" : "warning",
          title: `Crescimento rápido de log: ${name}`,
          detail: `+${deltaMB.toFixed(1)} MB desde a última verificação em ${file.path}`,
          path: file.path,
          sizeMB,
        });
      }
    }
  }

  for (const disk of disks) {
    if (disk.freeGB < 0) {
      findings.push({
        kind: "disk-error",
        severity: "warning",
        title: `Unidade não encontrada: ${disk.drive}`,
        detail: `Não foi possível consultar o espaço livre de ${disk.drive}`,
      });
    } else if (disk.freeGB < config.diskFreeThresholdGB) {
      findings.push({
        kind: "disk-free",
        severity: disk.freeGB < config.diskFreeThresholdGB / 2 ? "critical" : "warning",
        title: `Pouco espaço livre em ${disk.drive}`,
        detail: `${disk.freeGB.toFixed(1)} GB livres, limite de ${config.diskFreeThresholdGB} GB`,
        freeGB: disk.freeGB,
      });
    }
  }

  previous.clear();
  for (const [key, value] of nextPrevious) {
    if (seen.has(key)) {
      previous.set(key, value);
    }
  }

  return findings.sort(
    (a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1),
  );
}

function buildAlert(status: IoGuardStatus, checkedAt: string): AlertData {
  if (status.findings.length === 0) {
    return {
      cleared: true,
      severity: "warning",
      title: "",
      details: [],
      checkedAt,
      files: [],
    };
  }

  const critical = status.findings.filter((finding) => finding.severity === "critical").length;
  const warning = status.findings.length - critical;
  const details = status.findings
    .slice(0, 8)
    .map((finding) => `${finding.title}: ${finding.detail}`);
  const files = status.findings
    .filter((finding) => finding.path && finding.sizeMB !== undefined)
    .slice(0, 5)
    .map((finding) => ({ path: finding.path ?? "", sizeMB: finding.sizeMB ?? 0 }));

  return {
    cleared: false,
    severity: critical > 0 ? "critical" : "warning",
    title: `IO Guard: ${critical} crítico(s) e ${warning} aviso(s)`,
    details,
    checkedAt,
    files,
  };
}

function alertSignature(data: AlertData): string {
  if (data.cleared) {
    return "cleared";
  }
  return JSON.stringify([data.severity, data.title, data.details, data.files]);
}

async function publishAlert(paseo: PaseoApi, data: AlertData, targets: string[]): Promise<void> {
  if (targets.length === 0) {
    return;
  }
  console.log(`[io-guard] publicando alerta para ${targets.length} agente(s)`);

  await Promise.all(
    targets.map(async (agentId) => {
      try {
        await paseo.agents.ref(agentId).timeline.append({
          type: "plugin",
          id: ALERT_ID,
          kind: ALERT_KIND,
          version: 1,
          data,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[io-guard] falha ao avisar o agente ${agentId}: ${message}`);
      }
    }),
  );
}

export interface Monitor {
  start(): Promise<void>;
  stop(): void;
  setPaseo(paseo: PaseoApi): void;
  markLiveAgent(agentId: string): void;
  updateSettings(values: IoGuardSettings): void;
  runOnce(paseo?: PaseoApi): Promise<IoGuardStatus>;
  getStatus(): Promise<IoGuardStatus>;
}

export function createMonitor(settings: PluginSettings<typeof ioGuardSettings.schema>): Monitor {
  let config: IoGuardSettings = defaultSettings();
  let previous = new Map<string, SizeSample>();
  let lastStatus: IoGuardStatus | null = null;
  let lastSignature: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeSettings: (() => void) | null = null;
  let paseoApi: PaseoApi | null = null;
  const liveAgents = new Set<string>();

  const intervalMs = (): number => config.checkIntervalSeconds * 1000;

  const schedule = (): void => {
    if (timer) {
      clearInterval(timer);
    }
    timer = setInterval(() => {
      void runOnce(paseoApi ?? undefined);
    }, intervalMs());
  };

  async function runOnce(paseo?: PaseoApi): Promise<IoGuardStatus> {
    if (paseo) {
      paseoApi = paseo;
    }
    const now = Date.now();
    const checkedAt = new Date(now).toISOString();
    const files = await scanShellFiles(shellRoot());
    const disks = readDisks(config.drives);
    const findings = config.enabled ? evaluate(files, disks, config, previous, now) : [];
    if (!config.enabled) {
      previous = new Map();
    }

    const status: IoGuardStatus = {
      findings,
      files: files.slice(0, 25).map((file) => ({
        path: file.path,
        sizeMB: file.size / BYTES_PER_MB,
        modifiedAt: new Date(file.mtimeMs).toISOString(),
      })),
      disks,
      lastCheck: checkedAt,
      nextCheck: new Date(now + intervalMs()).toISOString(),
      config: {
        enabled: config.enabled,
        fileThresholdMB: config.fileThresholdMB,
        growthThresholdMB: config.growthThresholdMB,
        diskFreeThresholdGB: config.diskFreeThresholdGB,
        checkIntervalSeconds: config.checkIntervalSeconds,
        drives: config.drives,
      },
    };
    lastStatus = status;

    const data = buildAlert(status, checkedAt);
    const signature = alertSignature(data);
    if (signature !== lastSignature) {
      lastSignature = signature;
      if (paseoApi) {
        await publishAlert(paseoApi, data, [...liveAgents]);
      }
    }

    console.log(
      `[io-guard] verificação concluída: ${files.length} arquivos, ${disks.length} unidades, ${findings.length} alerta(s)`,
    );
    return status;
  }

  return {
    async start(): Promise<void> {
      const current = await settings.read();
      if (current.status === "ready") {
        config = current.values;
      }
      unsubscribeSettings = settings.subscribe((next) => {
        if (next.status === "ready") {
          config = next.values;
          schedule();
        }
      });
      schedule();
      await runOnce();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      unsubscribeSettings?.();
      unsubscribeSettings = null;
    },
    setPaseo(paseo: PaseoApi): void {
      paseoApi = paseo;
      if (lastSignature && lastStatus) {
        void publishAlert(
          paseo,
          buildAlert(lastStatus, lastStatus.lastCheck ?? new Date().toISOString()),
          [...liveAgents],
        );
      }
    },
    markLiveAgent(agentId: string): void {
      if (!liveAgents.has(agentId)) {
        liveAgents.add(agentId);
        lastSignature = null;
      }
    },
    updateSettings(values: IoGuardSettings): void {
      config = values;
      schedule();
    },
    runOnce,
    async getStatus(): Promise<IoGuardStatus> {
      if (!lastStatus) {
        return runOnce(paseoApi ?? undefined);
      }
      return lastStatus;
    },
  };
}

export async function cleanupFile(requestedPath: string): Promise<{ ok: boolean; error?: string }> {
  const root = resolve(shellRoot());
  const target = resolve(requestedPath);
  if (!target.startsWith(`${root}${sep}`)) {
    return { ok: false, error: "Caminho fora do diretório de shells do OpenCode" };
  }
  if (!/^sh_.*\.out$/i.test(basename(target))) {
    return { ok: false, error: "Nome de arquivo inválido" };
  }
  try {
    await unlink(target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
