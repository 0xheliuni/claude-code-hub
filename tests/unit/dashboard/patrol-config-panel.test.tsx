/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PatrolConfigPanel } from "@/app/[locale]/dashboard/patrol/_components/patrol-config-panel";

const {
  GLOBAL_CONFIG,
  PROVIDER_OVERRIDE,
  mockUpdateGlobal,
  mockUpdateProvider,
  mockDeleteProvider,
} = vi.hoisted(() => ({
  GLOBAL_CONFIG: {
    enabled: true,
    quickProbeEnabled: true,
    quickProbeCron: "0 * * * *",
    quickProbeTimeoutMs: 30000,
    quickProbeProbes: ["connectivity", "model_echo"],
    deepFingerprintEnabled: true,
    deepFingerprintCron: "0 4 * * *",
    deepFingerprintSamples: 100,
    deepFingerprintTimeoutMs: 300000,
    thresholdPass: 85,
    thresholdWarning: 50,
    thresholdCritical: 30,
    fingerprintMatchThreshold: 0.3,
    actionOnWarning: "circuit_open",
    actionOnCritical: "disable",
    actionOnCounterfeit: "disable",
    autoRecoverEnabled: true,
    autoRecoverPasses: 3,
    autoRecoverCounterfeit: false,
    notifyOnWarning: true,
    notifyOnCritical: true,
    notifyOnCounterfeit: true,
    notifyOnRecovery: true,
    concurrencyLimit: 3,
    retryAttempts: 1,
    cooldownMinutes: 5,
    probeWeights: null,
    skipPatrol: false,
    expectedChannel: null,
  },
  // Stable reference: the component's resync effect depends on this object's identity, and
  // react-query keeps `data` referentially stable across renders. Returning a fresh object per
  // call would cause an infinite render loop in the test.
  PROVIDER_OVERRIDE: { thresholdPass: 90 },
  mockUpdateGlobal: vi.fn(),
  mockUpdateProvider: vi.fn(),
  mockDeleteProvider: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api-client/v1/patrol/hooks", () => ({
  usePatrolConfig: () => ({ data: GLOBAL_CONFIG, isLoading: false, isError: false }),
  useProviderPatrolConfig: () => ({ data: PROVIDER_OVERRIDE, isLoading: false }),
  useUpdatePatrolConfig: () => ({ mutate: mockUpdateGlobal, isPending: false }),
  useUpdateProviderPatrolConfig: () => ({ mutate: mockUpdateProvider, isPending: false }),
  useDeleteProviderPatrolConfig: () => ({ mutate: mockDeleteProvider, isPending: false }),
}));

vi.mock("@/lib/api-client/v1/providers/hooks", () => ({
  useProviders: () => ({
    data: {
      items: [
        { id: 1, name: "Provider One" },
        { id: 2, name: "Provider Two" },
      ],
    },
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children?: ReactNode }) => <label>{children}</label>,
}));

// patrol-skeleton -> @/components/ui/skeleton -> cn -> the @/lib/utils barrel, which transitively
// imports env.schema (bare `import { z } from "zod"`). That bare import resolves to undefined under
// vitest's forks pool on Windows, so stub the skeleton leaf to keep the barrel out of the graph.
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => <div className={className} />,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
    disabled?: boolean;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function clickButton(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text)
  );
  if (!button) throw new Error(`button "${text}" not found`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("PatrolConfigPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = () => true;
  });

  it("renders grouped fields and probe checkboxes for the global scope", () => {
    const { container, unmount } = render(<PatrolConfigPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("fields.enabled.label");
    expect(text).toContain("fields.thresholdPass.label");
    expect(text).toContain("probeNames.connectivity");
    // Global scope shows no per-provider override toggle column.
    expect(text).not.toContain("clearOverrides");
    unmount();
  });

  it("saves the full global config when Save is clicked in global scope", () => {
    const { container, unmount } = render(<PatrolConfigPanel />);
    clickButton(container, "save");
    expect(mockUpdateGlobal).toHaveBeenCalledTimes(1);
    const payload = mockUpdateGlobal.mock.calls[0][0];
    expect(payload).toMatchObject({
      enabled: true,
      thresholdPass: 85,
      actionOnCritical: "disable",
    });
    expect(mockUpdateProvider).not.toHaveBeenCalled();
    unmount();
  });

  it("saves only overridden fields when a provider scope is selected", async () => {
    const { container, unmount } = render(<PatrolConfigPanel />);

    const scopeSelect = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      scopeSelect.value = "1";
      scopeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    clickButton(container, "save");
    expect(mockUpdateProvider).toHaveBeenCalledTimes(1);
    expect(mockUpdateProvider.mock.calls[0][0]).toEqual({
      providerId: 1,
      config: { thresholdPass: 90 },
    });
    unmount();
  });

  it("clears provider overrides when Clear is clicked in provider scope", async () => {
    const { container, unmount } = render(<PatrolConfigPanel />);

    const scopeSelect = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      scopeSelect.value = "2";
      scopeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    clickButton(container, "clearOverrides");
    expect(mockDeleteProvider).toHaveBeenCalledWith(2, expect.anything());
    unmount();
  });
});
