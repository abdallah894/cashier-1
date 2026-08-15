import { setRequestLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <Badge variant="secondary">{t("phase")}</Badge>
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground text-lg">{t("subtitle")}</p>
      <p className="text-muted-foreground max-w-md text-sm">{t("description")}</p>
    </div>
  );
}
