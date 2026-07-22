import type { PatrolAlertData } from "@/lib/patrol/notifier";
import type { MessageLevel, StructuredMessage } from "../types";

export function buildPatrolAlertMessage(
  data: PatrolAlertData,
  _timezone?: string
): StructuredMessage {
  const fields = [
    { label: "Score", value: `${data.score}/100` },
    { label: "Verdict", value: data.verdict },
    { label: "Action", value: data.actionTaken },
    { label: "Type", value: data.inspectionType },
  ];

  if (data.failedProbes.length > 0) {
    fields.push({ label: "Failed Probes", value: data.failedProbes.join(", ") });
  }

  const levelMap: Record<string, MessageLevel> = {
    pass: "info",
    warning: "warning",
    critical: "error",
    counterfeit: "error",
  };

  const title =
    data.actionTaken === "recovered"
      ? "Provider Recovered"
      : data.verdict === "counterfeit"
        ? "Provider Counterfeit Alert"
        : "Provider Patrol Alert";

  const description = `Provider "${data.providerName}" (ID: ${data.providerId}) - ${data.verdict}`;

  return {
    header: {
      title,
      level: levelMap[data.verdict] ?? "warning",
    },
    sections: [
      {
        content: [{ type: "quote", value: description }],
      },
      {
        title: "Details",
        content: [{ type: "fields", items: fields }],
      },
    ],
    timestamp: new Date(data.timestamp),
  };
}
