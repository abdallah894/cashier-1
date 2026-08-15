// Route group without the sidebar shell — login (and future PIN screens)
// render centered on a bare page.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-svh items-center justify-center p-6">{children}</div>
  );
}
