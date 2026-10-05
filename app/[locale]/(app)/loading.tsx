import { Skeleton } from "@/components/ui/skeleton";

// Route-level Suspense fallback for every page in the signed-in shell
// (Vue/Nuxt: the <NuxtPage> loading state; Next shows this while the server component awaits).
export default function AppLoading() {
  return (
    <div className="flex w-full flex-col gap-4" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
