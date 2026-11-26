import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { cleanupRpc, statusRpc, type IoGuardStatus } from "../shared/contracts.js";
import { ioGuardSettings, type IoGuardSettings } from "../shared/settings.js";

function toNumber(text: string, fallback: number): number {
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "ainda sem verificação";
  }
  return new Date(value).toLocaleString("pt-BR");
}

export function IoGuardSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(ioGuardSettings);
  const getStatus = useRpc(statusRpc);
  const removeFile = useRpc(cleanupRpc);
  const [draft, setDraft] = useState<IoGuardSettings | null>(null);
  const [drivesText, setDrivesText] = useState("C:\\, G:\\");
  const [status, setStatus] = useState<IoGuardStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getStatus({}));
      setStatusError(null);
    } catch (error) {
      setStatusError(String(error));
    }
  }, [getStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (settings.status === "ready") {
      setDraft(settings.values);
      setDrivesText(settings.values.drives.join(", "));
    }
  }, [settings.status, settings.status === "ready" ? settings.revision : ""]);

  const styles = useMemo(
    () => ({
      screen: {
        gap: layout.compact ? 10 : 14,
      },
      text: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 12 : 13,
      },
      muted: {
        color: theme.colors.foregroundMuted,
        fontSize: layout.compact ? 11 : 12,
      },
      error: {
        color: theme.colors.statusDanger,
        fontSize: layout.compact ? 12 : 13,
      },
      button: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
      },
      buttonLabel: {
        color: theme.colors.accent,
        fontSize: 12,
      },
      row: {
        gap: 4,
        paddingVertical: 6,
      },
    }),
    [theme, layout.compact],
  );

  const update = (patch: Partial<IoGuardSettings>): void => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const save = async (): Promise<void> => {
    if (!draft || settings.status !== "ready") {
      return;
    }
    const values: IoGuardSettings = {
      ...draft,
      drives: drivesText
        .split(",")
        .map((drive) => drive.trim())
        .filter((drive) => drive.length > 0),
    };
    const saved = await settings.save(values, settings.revision);
    if (saved) {
      await refresh();
    }
  };

  const handleCleanup = async (path: string): Promise<void> => {
    if (confirmPath !== path) {
      setConfirmPath(path);
      setActionError(null);
      return;
    }
    const result = await removeFile({ path });
    if (!result.ok) {
      setActionError(result.error ?? "Falha ao remover o arquivo");
    }
    setConfirmPath(null);
    await refresh();
  };

  if (settings.status !== "ready" || !draft) {
    return (
      <View style={styles.screen}>
        <Text style={styles.error}>
          {settings.status === "invalid"
            ? `Configuração inválida: ${settings.error}`
            : "Carregando configuração..."}
        </Text>
        <Pressable style={styles.button} onPress={() => void settings.reset()}>
          <Text style={styles.buttonLabel}>Restaurar padrões</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SettingsSection title="Monitoramento">
        <SettingsCard>
          <SettingsSwitch
            label="Monitorar I/O"
            hint="Verifica logs de shell e espaço em disco periodicamente"
            value={draft.enabled}
            onValueChange={(enabled) => update({ enabled })}
          />
          <SettingsInput
            label="Limite por arquivo (MB)"
            initialValue={String(draft.fileThresholdMB)}
            onChangeText={(text) =>
              update({ fileThresholdMB: toNumber(text, draft.fileThresholdMB) })
            }
          />
          <SettingsInput
            label="Crescimento por verificação (MB)"
            hint="Alerta quando um log cresce mais que isso entre verificações"
            initialValue={String(draft.growthThresholdMB)}
            onChangeText={(text) =>
              update({ growthThresholdMB: toNumber(text, draft.growthThresholdMB) })
            }
          />
          <SettingsInput
            label="Espaço livre mínimo (GB)"
            initialValue={String(draft.diskFreeThresholdGB)}
            onChangeText={(text) =>
              update({ diskFreeThresholdGB: toNumber(text, draft.diskFreeThresholdGB) })
            }
          />
          <SettingsInput
            label="Intervalo (segundos)"
            initialValue={String(draft.checkIntervalSeconds)}
            onChangeText={(text) =>
              update({ checkIntervalSeconds: toNumber(text, draft.checkIntervalSeconds) })
            }
          />
          <SettingsInput
            label="Unidades monitoradas"
            hint="Separadas por vírgula"
            initialValue={drivesText}
            onChangeText={setDrivesText}
          />
          <SettingsAction
            label="Alterações salvas"
            actionLabel="Salvar"
            onPress={() => void save()}
            disabled={settings.saving}
          />
          {settings.saveError ? <Text style={styles.error}>{settings.saveError}</Text> : null}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Estado atual">
        <SettingsCard>
          <SettingsAction
            label="Atualizar leitura"
            actionLabel="Atualizar"
            onPress={() => void refresh()}
          />
          {statusError ? <Text style={styles.error}>{statusError}</Text> : null}
          {status ? (
            <View style={styles.screen}>
              <Text
                style={styles.muted}
              >{`Última verificação: ${formatDate(status.lastCheck)}`}</Text>
              <Text
                style={styles.muted}
              >{`Próxima verificação: ${formatDate(status.nextCheck)}`}</Text>
              <Text style={styles.text}>{`Alertas ativos: ${status.findings.length}`}</Text>
              {status.disks.map((disk) => (
                <Text key={disk.drive} style={styles.text}>
                  {`${disk.drive}: ${disk.freeGB.toFixed(1)} GB livres de ${disk.totalGB.toFixed(1)} GB`}
                </Text>
              ))}
            </View>
          ) : null}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Arquivos de shell">
        <SettingsCard>
          {status && status.files.length > 0 ? (
            status.files.slice(0, 10).map((file) => (
              <View key={file.path} style={styles.row}>
                <Text style={styles.muted}>{`${file.sizeMB.toFixed(1)} MB`}</Text>
                <Text style={styles.text}>{file.path}</Text>
                <Pressable style={styles.button} onPress={() => void handleCleanup(file.path)}>
                  <Text style={styles.buttonLabel}>
                    {confirmPath === file.path ? "Confirmar remoção" : "Remover"}
                  </Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>Nenhum arquivo de log de shell encontrado.</Text>
          )}
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          <Text style={styles.muted}>
            A remoção exige confirmação e nunca acontece automaticamente.
          </Text>
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
