import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// Reports runs several SQL aggregations in parallel; this Suspense fallback
// gives instant feedback on navigation (React equivalent of a route-level
// <template #fallback> — Next renders it while the server component awaits).
export default function ReportsLoading() {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-9 w-full max-w-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} size="sm">
            <CardHeader>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-28" />
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="border-b">
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="pt-4">
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
