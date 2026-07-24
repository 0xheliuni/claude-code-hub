"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PatrolConfig } from "@/lib/api-client/v1/patrol/hooks";
import { ALL_PATROL_PROBES } from "@/lib/constants/patrol.constants";

type FieldKey = keyof PatrolConfig;

const ACTION_OPTIONS = ["none", "circuit_open", "disable", "notify_only", "recovered"] as const;

export interface OverrideMode {
  overridden: Set<FieldKey>;
  onToggle: (field: FieldKey, on: boolean) => void;
}

interface PatrolConfigFieldsProps {
  value: PatrolConfig;
  onChange: (patch: Partial<PatrolConfig>) => void;
  disabled?: boolean;
  overrideMode?: OverrideMode;
  /** Show the fields that only make sense per-provider (skipPatrol, expectedChannel). */
  showProviderScopedFields?: boolean;
}

export function PatrolConfigFields({
  value,
  onChange,
  disabled = false,
  overrideMode,
  showProviderScopedFields = false,
}: PatrolConfigFieldsProps) {
  const t = useTranslations("dashboard.patrol.config");
  const tAction = useTranslations("dashboard.patrol.actionTypes");

  const shared = { value, onChange, disabled, overrideMode, t } as const;

  return (
    <div className="space-y-4">
      <Group title={t("general")}>
        <BoolField field="enabled" {...shared} />
        {showProviderScopedFields ? (
          <>
            <BoolField field="skipPatrol" {...shared} />
            <TextField field="expectedChannel" {...shared} />
          </>
        ) : null}
      </Group>

      <Group title={t("scheduling")}>
        <BoolField field="quickProbeEnabled" {...shared} />
        <TextField field="quickProbeCron" {...shared} />
        <NumberField field="quickProbeTimeoutMs" {...shared} />
        <BoolField field="deepFingerprintEnabled" {...shared} />
        <TextField field="deepFingerprintCron" {...shared} />
        <NumberField field="deepFingerprintSamples" {...shared} />
        <NumberField field="deepFingerprintTimeoutMs" {...shared} />
      </Group>

      <Group title={t("probes")}>
        <ProbeChecklist {...shared} />
      </Group>

      <Group title={t("thresholds")}>
        <NumberField field="thresholdPass" {...shared} />
        <NumberField field="thresholdWarning" {...shared} />
        <NumberField field="thresholdCritical" {...shared} />
        <NumberField field="fingerprintMatchThreshold" step="0.01" {...shared} />
      </Group>

      <Group title={t("actions")}>
        <ActionField field="actionOnWarning" tAction={tAction} {...shared} />
        <ActionField field="actionOnCritical" tAction={tAction} {...shared} />
        <ActionField field="actionOnCounterfeit" tAction={tAction} {...shared} />
      </Group>

      <Group title={t("recovery")}>
        <BoolField field="autoRecoverEnabled" {...shared} />
        <NumberField field="autoRecoverPasses" {...shared} />
        <BoolField field="autoRecoverCounterfeit" {...shared} />
      </Group>

      <Group title={t("notifications")}>
        <BoolField field="notifyOnWarning" {...shared} />
        <BoolField field="notifyOnCritical" {...shared} />
        <BoolField field="notifyOnCounterfeit" {...shared} />
        <BoolField field="notifyOnRecovery" {...shared} />
      </Group>

      <Group title={t("advanced")}>
        <NumberField field="concurrencyLimit" {...shared} />
        <NumberField field="retryAttempts" {...shared} />
        <NumberField field="cooldownMinutes" {...shared} />
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

type Translate = ReturnType<typeof useTranslations>;

interface FieldShellProps {
  field: FieldKey;
  t: Translate;
  overrideMode?: OverrideMode;
  children: (controlDisabled: boolean) => ReactNode;
}

function FieldShell({ field, t, overrideMode, children }: FieldShellProps) {
  const overridden = overrideMode ? overrideMode.overridden.has(field) : true;
  const controlDisabled = overrideMode ? !overridden : false;
  return (
    <div className="space-y-1.5 border-b border-border/40 pb-3 last:border-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label className={overrideMode && !overridden ? "text-muted-foreground" : undefined}>
            {t(`fields.${field}.label` as never)}
          </Label>
          <p className="text-xs text-muted-foreground">{t(`fields.${field}.desc` as never)}</p>
        </div>
        {overrideMode ? (
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {overridden ? t("override") : t("inherit")}
            <Switch
              checked={overridden}
              onCheckedChange={(on) => overrideMode.onToggle(field, on)}
            />
          </label>
        ) : null}
      </div>
      {children(controlDisabled)}
    </div>
  );
}

interface SharedFieldProps {
  field: FieldKey;
  value: PatrolConfig;
  onChange: (patch: Partial<PatrolConfig>) => void;
  disabled: boolean;
  overrideMode?: OverrideMode;
  t: Translate;
}

function patch(field: FieldKey, val: unknown): Partial<PatrolConfig> {
  return { [field]: val } as Partial<PatrolConfig>;
}

function BoolField({ field, value, onChange, disabled, overrideMode, t }: SharedFieldProps) {
  return (
    <FieldShell field={field} t={t} overrideMode={overrideMode}>
      {(controlDisabled) => (
        <Switch
          checked={Boolean(value[field])}
          disabled={disabled || controlDisabled}
          onCheckedChange={(v) => onChange(patch(field, v))}
        />
      )}
    </FieldShell>
  );
}

function NumberField({
  field,
  value,
  onChange,
  disabled,
  overrideMode,
  t,
  step,
}: SharedFieldProps & { step?: string }) {
  const raw = value[field];
  return (
    <FieldShell field={field} t={t} overrideMode={overrideMode}>
      {(controlDisabled) => (
        <Input
          type="number"
          step={step}
          value={raw === undefined || raw === null ? "" : String(raw)}
          disabled={disabled || controlDisabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== "" && !Number.isNaN(n)) onChange(patch(field, n));
          }}
        />
      )}
    </FieldShell>
  );
}

function TextField({ field, value, onChange, disabled, overrideMode, t }: SharedFieldProps) {
  const raw = value[field];
  return (
    <FieldShell field={field} t={t} overrideMode={overrideMode}>
      {(controlDisabled) => (
        <Input
          type="text"
          value={raw === undefined || raw === null ? "" : String(raw)}
          disabled={disabled || controlDisabled}
          onChange={(e) => onChange(patch(field, e.target.value === "" ? null : e.target.value))}
        />
      )}
    </FieldShell>
  );
}

function ActionField({
  field,
  value,
  onChange,
  disabled,
  overrideMode,
  t,
  tAction,
}: SharedFieldProps & { tAction: Translate }) {
  const raw = value[field];
  return (
    <FieldShell field={field} t={t} overrideMode={overrideMode}>
      {(controlDisabled) => (
        <Select
          value={typeof raw === "string" ? raw : "none"}
          disabled={disabled || controlDisabled}
          onValueChange={(v) => onChange(patch(field, v))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((action) => (
              <SelectItem key={action} value={action}>
                {tAction(action)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FieldShell>
  );
}

function ProbeChecklist({
  value,
  onChange,
  disabled,
  overrideMode,
  t,
}: Omit<SharedFieldProps, "field">) {
  const field: FieldKey = "quickProbeProbes";
  const selected = new Set(Array.isArray(value.quickProbeProbes) ? value.quickProbeProbes : []);
  return (
    <FieldShell field={field} t={t} overrideMode={overrideMode}>
      {(controlDisabled) => (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_PATROL_PROBES.map((probe) => (
            <label key={probe} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(probe)}
                disabled={disabled || controlDisabled}
                onCheckedChange={(checked) => {
                  const next = new Set(selected);
                  if (checked === true) next.add(probe);
                  else next.delete(probe);
                  onChange(patch(field, Array.from(next)));
                }}
              />
              <span>{t(`probeNames.${probe}` as never)}</span>
            </label>
          ))}
        </div>
      )}
    </FieldShell>
  );
}
