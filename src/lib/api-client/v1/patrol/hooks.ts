"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";

function toQuery(params?: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export interface PatrolStatus {
  enabled: boolean;
  providerCount: number;
  lastRunAt: string | null;
  recentResults: PatrolResult[];
}

export interface PatrolResult {
  id: number;
  providerId: number;
  inspectionType: string;
  score: number;
  verdict: string;
  probeDetails: PatrolProbeDetail[];
  actionTaken: string | null;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: string | null;
}

export interface PatrolProbeDetail {
  name: string;
  label: string;
  category: string;
  weight: number;
  passed: boolean;
  score: number;
  detail: string;
  latencyMs: number;
}

export interface PatrolConfig {
  enabled?: boolean;
  quickProbeEnabled?: boolean;
  quickProbeCron?: string;
  quickProbeTimeoutMs?: number;
  quickProbeProbes?: string[];
  deepFingerprintEnabled?: boolean;
  deepFingerprintCron?: string;
  deepFingerprintSamples?: number;
  deepFingerprintTimeoutMs?: number;
  thresholdPass?: number;
  thresholdWarning?: number;
  thresholdCritical?: number;
  fingerprintMatchThreshold?: number;
  actionOnWarning?: string;
  actionOnCritical?: string;
  actionOnCounterfeit?: string;
  autoRecoverEnabled?: boolean;
  autoRecoverPasses?: number;
  autoRecoverCounterfeit?: boolean;
  notifyOnWarning?: boolean;
  notifyOnCritical?: boolean;
  notifyOnCounterfeit?: boolean;
  notifyOnRecovery?: boolean;
  concurrencyLimit?: number;
  retryAttempts?: number;
  cooldownMinutes?: number;
  probeWeights?: Record<string, number> | null;
  skipPatrol?: boolean;
  expectedChannel?: string | null;
}

export interface PatrolBaseline {
  id: number;
  modelName: string;
  label: string | null;
  providerType: string;
  sampleCount: number;
  calibratedAt: string | null;
  calibratedBy: string | null;
  notes: string | null;
}

export interface PatrolProbeInfo {
  name: string;
  label: string;
  category: string;
  defaultWeight: number;
}

export function usePatrolStatus() {
  return useQuery({
    queryKey: v1Keys.patrol.status(),
    queryFn: () => apiClient.get<PatrolStatus>("/api/v1/patrol/status"),
  });
}

export function usePatrolResults(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: v1Keys.patrol.results(params),
    queryFn: () =>
      apiClient.get<{ results: PatrolResult[]; total: number; limit: number; offset: number }>(
        `/api/v1/patrol/results${toQuery(params)}`
      ),
  });
}

export function usePatrolConfig() {
  return useQuery({
    queryKey: v1Keys.patrol.config(),
    queryFn: () => apiClient.get<PatrolConfig>("/api/v1/patrol/config/global"),
  });
}

export function usePatrolBaselines() {
  return useQuery({
    queryKey: v1Keys.patrol.baselines(),
    queryFn: () => apiClient.get<PatrolBaseline[]>("/api/v1/patrol/baselines"),
  });
}

export function usePatrolProbes() {
  return useQuery({
    queryKey: v1Keys.patrol.probes(),
    queryFn: () => apiClient.get<PatrolProbeInfo[]>("/api/v1/patrol/probes"),
  });
}

export function useTriggerPatrol() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { providerId?: number; inspectionType?: string }) =>
      apiClient.post<{ triggered: boolean }>("/api/v1/patrol/trigger", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: v1Keys.patrol.all });
    },
  });
}

export function useUpdatePatrolConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: Partial<PatrolConfig>) =>
      apiClient.put<PatrolConfig>("/api/v1/patrol/config/global", config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: v1Keys.patrol.config() });
    },
  });
}

export function useProviderPatrolConfig(providerId: number) {
  return useQuery({
    queryKey: v1Keys.patrol.providerConfig(providerId),
    queryFn: () =>
      apiClient.get<Partial<PatrolConfig>>(`/api/v1/patrol/config/provider/${providerId}`),
    enabled: Number.isFinite(providerId) && providerId > 0,
  });
}

export function useUpdateProviderPatrolConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, config }: { providerId: number; config: Partial<PatrolConfig> }) =>
      apiClient.put<PatrolConfig>(`/api/v1/patrol/config/provider/${providerId}`, config),
    onSuccess: (_data, { providerId }) => {
      queryClient.invalidateQueries({ queryKey: v1Keys.patrol.providerConfig(providerId) });
      queryClient.invalidateQueries({ queryKey: v1Keys.patrol.config() });
    },
  });
}

export function useDeleteProviderPatrolConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: number) =>
      apiClient.delete<{ deleted: boolean }>(`/api/v1/patrol/config/provider/${providerId}`),
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({ queryKey: v1Keys.patrol.providerConfig(providerId) });
      queryClient.invalidateQueries({ queryKey: v1Keys.patrol.config() });
    },
  });
}

export function useRecoverProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: number) =>
      apiClient.post<{ recovered: boolean }>(`/api/v1/patrol/recover/${providerId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: v1Keys.patrol.all });
    },
  });
}
