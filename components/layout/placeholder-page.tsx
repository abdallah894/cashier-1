import { getTranslations } from "next-intl/server";

// Server Component — no "use client": it only renders text.
export async function PlaceholderPage({
  titleKey,
}: {
  titleKey: "register" | "products" | "reports" | "shifts";
}) {
  const tNav = await getTranslations("nav");
  const t = await getTranslations("placeholder");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{tNav(titleKey)}</h1>
      <p className="text-muted-foreground text-sm">{t(titleKey)}</p>
    </div>
  );
}
