import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware wrappers around Next.js navigation APIs.
// Always import Link/useRouter/usePathname from here, not from "next/*",
// so the current locale prefix (/ar, /en) is preserved automatically.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
