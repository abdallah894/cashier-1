import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono, Cairo } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { routing, getDirection } from "@/i18n/routing";
import { nonceFromHeaders } from "@/lib/security/nonce";
import { Providers } from "@/components/providers";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Arabic-capable font; Geist has no Arabic glyphs.
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    title: t("appName"),
    // manifest is auto-linked from app/manifest.ts; these round out the
    // installable/standalone experience on the counter device.
    appleWebApp: { capable: true, title: t("appName"), statusBarStyle: "default" },
    icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  };
}

// Browser UI / theme color for the installed PWA (Next 16 wants this in
// viewport, not metadata).
export const viewport: Viewport = {
  themeColor: "#0f8a5f",
  // draw under notches / rounded corners; pages add safe-area padding
  viewportFit: "cover",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Next 15+: params is a Promise (in Vue/Nuxt you'd read route.params synchronously).
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Enables static rendering for this locale subtree.
  setRequestLocale(locale);

  const dir = getDirection(locale);
  // the theme script is inline: it needs this request's CSP nonce
  const nonce = nonceFromHeaders(await headers());

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} h-full antialiased`}
      // next-themes mutates <html class> on the client before hydration.
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <Providers dir={dir} nonce={nonce}>
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}