"use client";

import { Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type PatrolConfig,
  useDeleteProviderPatrolConfig,
  usePatrolConfig,
  useProviderPatrolConfig,
  useUpdatePatrolConfig,
  useUpdateProviderPatrolConfig,
} from "@/lib/api-client/v1/patrol/hooks";
import { useProviders } from "@/lib/api-client/v1/providers/hooks";
import { type OverrideMode, PatrolConfigFields } from "./patrol-config-fields";
import { PatrolSkeleton } from "./patrol-skeleton";

const GLOBAL_SCOPE = "global";

type FieldKey = keyof PatrolConfig;

export function PatrolConfigPanel() {
  const t = useTranslations("dashboard.patrol.config");
  const [scope, setScope] = useState<string>(GLOBAL_SCOPE);
  const providerId = scope === GLOBAL_SCOPE ? 0 : Number(scope);
  const isProvider = providerId > 0;

  const globalQuery = usePatrolConfig();
  const providerQuery = useProviderPatrolConfig(providerId);
  const providersQuery = useProviders();
  const updateGlobal = useUpdatePatrolConfig();
  const updateProvider = useUpdateProviderPatrolConfig();
  const deleteProvider = useDeleteProviderPatrolConfig();

  const [draft, setDraft] = useState<PatrolConfig>({});
  const [overridden, setOverridden] = useState<Set<FieldKey>>(new Set());

  const globalConfig = globalQuery.data;
  const providerOverride = providerQuery.data;

  // Resync the editable draft whenever the scope or the underlying server data changes.
  // react-query structural sharing keeps `data` referentially stable across no-op refetches,
  // so this does not clobber in-progress edits on background refreshes.
  useEffect(() => {
    if (!isProvider) {
      setDraft({ ...(globalConfig ?? {}) });
      setOverridden(new Set());
      return;
    }
    if (globalConfig && providerOverride) {
      setDraft({ ...globalConfig, ...providerOverride });
      setOverridden(new Set(Object.keys(providerOverride) as FieldKey[]));
    }
  }, [isProvider, globalConfig, providerOverride]);

  const overrideMode: OverrideMode | undefined = useMemo(() => {
    if (!isProvider) return undefined;
    return {
      overridden,
      onToggle: (field, on) => {
        setOverridden((cur) => {
          const next = new Set(cur);
          if (on) next.add(field);
          else next.delete(field);
          return next;
        });
        if (!on) {
          setDraft((cur) => ({ ...cur, [field]: globalConfig?.[field] }));
        }
      },
    };
  }, [isProvider, overridden, globalConfig]);

  const isSaving = updateGlobal.isPending || updateProvider.isPending;

  const handleSave = () => {
    if (!isProvider) {
      updateGlobal.mutate(draft, {
        onSuccess: () => toast.success(t("saved")),
        onError: () => toast.error(t("saveFailed")),
      });
      return;
    }
    const payload: Partial<PatrolConfig> = {};
    for (const key of overridden) {
      (payload as Record<string, unknown>)[key] = draft[key];
    }
    updateProvider.mutate(
      { providerId, config: payload },
      {
        onSuccess: () => toast.success(t("saved")),
        onError: () => toast.error(t("saveFailed")),
      }
    );
  };

  const handleClear = () => {
    if (!isProvider) return;
    if (!window.confirm(t("clearConfirm"))) return;
    deleteProvider.mutate(providerId, {
      onSuccess: () => toast.success(t("cleared")),
      onError: () => toast.error(t("saveFailed")),
    });
  };

  if (globalQuery.isLoading) return <PatrolSkeleton />;
  if (globalQuery.isError) return <p className="text-sm text-destructive">{t("loadFailed")}</p>;

  const providers = providersQuery.data?.items ?? [];
  const loadingProvider = isProvider && providerQuery.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <Label>{t("scope")}</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GLOBAL_SCOPE}>{t("scopeGlobal")}</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={String(provider.id)}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {isProvider ? (
            <Button variant="outline" onClick={handleClear} disabled={deleteProvider.isPending}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("clearOverrides")}
            </Button>
          ) : null}
          <Button onClick={handleSave} disabled={isSaving || loadingProvider}>
            <Save className="mr-2 h-4 w-4" />
            {t("save")}
          </Button>
        </div>
      </div>

      {loadingProvider ? (
        <PatrolSkeleton />
      ) : (
        <PatrolConfigFields
          value={draft}
          onChange={(fieldPatch) => setDraft((cur) => ({ ...cur, ...fieldPatch }))}
          disabled={isSaving}
          overrideMode={overrideMode}
          showProviderScopedFields={isProvider}
        />
      )}
    </div>
  );
}
