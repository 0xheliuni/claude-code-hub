"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  usePatrolResults,
  usePatrolStatus,
  useTriggerPatrol,
} from "@/lib/api-client/v1/patrol/hooks";
import { PatrolConfigPanel } from "./patrol-config-panel";
import { PatrolSkeleton } from "./patrol-skeleton";

export function PatrolDashboard() {
  const t = useTranslations("dashboard.patrol");
  const { data: status, isLoading: statusLoading } = usePatrolStatus();
  const { data: resultsData, isLoading: resultsLoading } = usePatrolResults({ limit: 20 });
  const triggerMutation = useTriggerPatrol();

  if (statusLoading) return <PatrolSkeleton />;

  const results = resultsData?.results ?? [];

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
        <TabsTrigger value="config">{t("tabs.config")}</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-0">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("status.enabled")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={status?.enabled ? "default" : "secondary"}>
                  {status?.enabled ? t("status.enabled") : t("status.disabled")}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("status.lastRun")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold">
                  {status?.lastRunAt
                    ? new Date(status.lastRunAt).toLocaleString()
                    : t("status.never")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("actions.trigger")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  onClick={() => triggerMutation.mutate({})}
                  disabled={triggerMutation.isPending}
                >
                  {t("actions.triggerAll")}
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("results.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {resultsLoading ? (
                <PatrolSkeleton />
              ) : results.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{t("results.empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("results.provider")}</TableHead>
                        <TableHead>{t("results.type")}</TableHead>
                        <TableHead>{t("results.score")}</TableHead>
                        <TableHead>{t("results.verdict")}</TableHead>
                        <TableHead>{t("results.action")}</TableHead>
                        <TableHead>{t("results.latency")}</TableHead>
                        <TableHead>{t("results.time")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((result) => (
                        <TableRow key={result.id}>
                          <TableCell>{result.providerId}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {t(`inspectionTypes.${result.inspectionType}` as never)}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono">{result.score}</TableCell>
                          <TableCell>
                            <VerdictBadge verdict={result.verdict} t={t} />
                          </TableCell>
                          <TableCell>
                            {result.actionTaken
                              ? t(`actionTypes.${result.actionTaken}` as never)
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {result.latencyMs != null ? `${result.latencyMs}ms` : "-"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {result.createdAt ? new Date(result.createdAt).toLocaleString() : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="config" className="mt-0">
        <PatrolConfigPanel />
      </TabsContent>
    </Tabs>
  );
}

function VerdictBadge({ verdict, t }: { verdict: string; t: ReturnType<typeof useTranslations> }) {
  const variantMap: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pass: "default",
    warning: "secondary",
    critical: "destructive",
    counterfeit: "destructive",
  };

  return (
    <Badge variant={variantMap[verdict] ?? "outline"}>{t(`verdicts.${verdict}` as never)}</Badge>
  );
}
