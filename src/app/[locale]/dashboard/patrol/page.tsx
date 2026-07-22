import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Section } from "@/components/section";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { PatrolDashboard } from "./_components/patrol-dashboard";
import { PatrolSkeleton } from "./_components/patrol-skeleton";

export const dynamic = "force-dynamic";

export default async function PatrolPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return redirect({ href: "/dashboard", locale });
  }

  const t = await getTranslations({ locale, namespace: "dashboard.patrol" });

  return (
    <div className="space-y-6">
      <Section title={t("title")} description={t("description")}>
        <Suspense fallback={<PatrolSkeleton />}>
          <PatrolDashboard />
        </Suspense>
      </Section>
    </div>
  );
}
