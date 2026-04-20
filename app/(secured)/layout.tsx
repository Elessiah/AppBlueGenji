import { requireCurrentUser } from "@/lib/server/auth";
import { ArenaNav } from "@/components/arena-nav";

export default async function SecuredLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCurrentUser();

  return (
    <main className="page-shell">
      <ArenaNav pseudo={user.pseudo} avatarUrl={user.avatarUrl} />
      {children}
    </main>
  );
}
