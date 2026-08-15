"use client";

import { useState } from "react";
import { ThemeProvider } from "next-themes";
import { DirectionProvider } from "@radix-ui/react-direction";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// Client-side context providers, kept in one place so the server layout
// stays a Server Component. (Vue mapping: this is roughly app.use(plugin)
// calls in a Nuxt plugin file — React composes providers as JSX instead.)
export function Providers({ dir, children }: { dir: "rtl" | "ltr"; children: React.ReactNode }) {
  // useState initializer keeps one QueryClient per browser session,
  // without sharing it across server requests.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <DirectionProvider dir={dir}>
          <TooltipProvider delayDuration={0}>
            {children}
            <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} />
          </TooltipProvider>
        </DirectionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
