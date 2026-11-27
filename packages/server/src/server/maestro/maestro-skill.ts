import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import {
  MAESTRO_CONTEXT_RECOMMENDATION,
  MAESTRO_SKILL_DIRECTORY,
  MAESTRO_SKILL_DIRECTORY_NAME,
  MAESTRO_SKILL_REPOSITORY,
} from "@getpaseo/protocol/maestro";

const GITHUB_API = "https://api.github.com";
const RAW_CONTENT = "https://raw.githubusercontent.com";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

interface TreeEntry {
  path: string;
  type: string;
}

export interface MaestroSkillStatus {
  installed: boolean;
  commit: string | null;
  checkedAt: string | null;
  error: string | null;
  path: string;
  source: string;
}

interface Manifest {
  commit: string;
  checkedAt: string;
}

/**
 * Owns the daemon copy of the upstream Maestro skill. The skill is the source of
 * truth for Maestro behaviour, so it is downloaded from GitHub and refreshed in
 * the background. A failed refresh never replaces a working local copy.
 */
export class MaestroSkillService {
  private manifest: Manifest | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight: Promise<MaestroSkillStatus> | null = null;

  constructor(
    private readonly options: { paseoHome: string; logger: Logger; fetch?: typeof fetch },
  ) {}

  get skillDirectory(): string {
    return path.join(this.options.paseoHome, MAESTRO_SKILL_DIRECTORY_NAME);
  }

  private get manifestPath(): string {
    return path.join(this.options.paseoHome, "maestro", "skill-manifest.json");
  }

  /** Starts the periodic check. Call once at daemon bootstrap. */
  start(): void {
    if (this.timer) return;
    void this.refresh().catch(() => undefined);
    this.timer = setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async status(): Promise<MaestroSkillStatus> {
    const manifest = await this.readManifest();
    const installed = await this.hasSkillFile();
    return {
      installed,
      commit: manifest?.commit ?? null,
      checkedAt: manifest?.checkedAt ?? null,
      error: null,
      path: this.skillDirectory,
      source: `${MAESTRO_SKILL_REPOSITORY}/${MAESTRO_SKILL_DIRECTORY}`,
    };
  }

  /** Downloads the skill when missing or outdated, keeping the old copy on failure. */
  async refresh(): Promise<MaestroSkillStatus> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.refreshUnlocked().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refreshUnlocked(): Promise<MaestroSkillStatus> {
    const current = await this.readManifest();
    try {
      const branch = await this.fetchJson<{ sha: string }>(
        `${GITHUB_API}/repos/${MAESTRO_SKILL_REPOSITORY}/commits/master`,
      );
      if (current?.commit === branch.sha && (await this.hasSkillFile())) {
        return { ...(await this.status()), checkedAt: new Date().toISOString() };
      }
      const tree = await this.fetchJson<{ tree: TreeEntry[] }>(
        `${GITHUB_API}/repos/${MAESTRO_SKILL_REPOSITORY}/git/trees/${branch.sha}?recursive=1`,
      );
      const files = tree.tree.filter(
        (entry) => entry.type === "blob" && this.isSkillPath(entry.path),
      );
      if (files.length === 0) throw new Error("Maestro skill folder is empty upstream");
      for (const file of files) {
        const relative = file.path.slice(MAESTRO_SKILL_DIRECTORY.length + 1);
        const response = await this.fetchText(
          `${RAW_CONTENT}/${MAESTRO_SKILL_REPOSITORY}/master/${file.path}`,
        );
        const target = path.join(this.skillDirectory, ...relative.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, response, "utf8");
      }
      const manifest = { commit: branch.sha, checkedAt: new Date().toISOString() };
      await mkdir(path.dirname(this.manifestPath), { recursive: true });
      await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      this.manifest = manifest;
      return { ...(await this.status()), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.logger.warn({ err: error }, "maestro.skill.refresh_failed");
      const status = await this.status();
      return { ...status, error: message };
    }
  }

  private isSkillPath(entryPath: string): boolean {
    if (!entryPath.startsWith(`${MAESTRO_SKILL_DIRECTORY}/`)) return false;
    const relative = entryPath.slice(MAESTRO_SKILL_DIRECTORY.length + 1);
    return (
      relative.length > 0 &&
      relative.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
    );
  }

  private async readManifest(): Promise<Manifest | null> {
    if (this.manifest) return this.manifest;
    try {
      const parsed = JSON.parse(await readFile(this.manifestPath, "utf8")) as Partial<Manifest>;
      if (typeof parsed.commit === "string" && typeof parsed.checkedAt === "string") {
        this.manifest = { commit: parsed.commit, checkedAt: parsed.checkedAt };
      }
    } catch {
      // A missing or damaged manifest just means "check upstream".
    }
    return this.manifest;
  }

  private async hasSkillFile(): Promise<boolean> {
    try {
      await stat(path.join(this.skillDirectory, "SKILL.md"));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The system prompt is the upstream SKILL.md plus the Paseo-specific contract.
   * Falls back to a short inline contract when the download has never succeeded.
   */
  async systemPrompt(input: { scope: "workspace" | "all"; cwd: string }): Promise<string> {
    let skill = "";
    try {
      skill = await readFile(path.join(this.skillDirectory, "SKILL.md"), "utf8");
    } catch {
      skill = FALLBACK_MAESTRO_SKILL;
    }
    const scopeLine =
      input.scope === "all"
        ? "Escopo: todos os workspaces do usuário. Você pode criar agentes em qualquer workspace."
        : `Escopo: apenas o workspace atual (${input.cwd}). Peça autorização antes de usar outro workspace.`;
    return [
      skill.trim(),
      "",
      "## Paseo (injeção do host)",
      "Você está rodando como o modo Maestro do Paseo.",
      "Para cada tarefa, use create_agent seguido de send_agent_prompt no mesmo agentId; registre cada id e reenvie revisões e correções para esse mesmo chat.",
      "Crie agentes com notifyUser: false para não notificar o usuário a cada worker.",
      "Prefira modelos com contexto maior para manter mais informação, exceto quando o usuário escolher outro modelo.",
      MAESTRO_CONTEXT_RECOMMENDATION,
      scopeLine,
      "Mantenha o ledger deste chat em todas as viradas: ele é a sua memória após compactação.",
    ].join("\n");
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.request(url);
    return (await response.json()) as T;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.request(url);
    return response.text();
  }

  private async request(url: string): Promise<Awaited<ReturnType<typeof fetch>>> {
    const fetchImpl = this.options.fetch ?? fetch;
    const token = process.env.GITHUB_TOKEN;
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "paseo-maestro-skill",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${url}`);
    return response;
  }
}

const FALLBACK_MAESTRO_SKILL = [
  "# Maestro",
  "",
  "Você é um orquestrador, não um trabalhador. Planeje, delegue, revise e reporte.",
  "Nunca escreva a entrega nem edite o código no seu próprio turno.",
  "Cada tarefa vai para um chat de worker com um brief autossuficiente; a revisão e as correções voltam para o mesmo chat.",
  "Peça evidências (comandos, saídas e diff) antes de aceitar qualquer resultado.",
].join("\n");
