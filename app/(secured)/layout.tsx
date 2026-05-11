import { requireCurrentUser } from "@/lib/server/auth";
import { ArenaNav } from "@/components/arena-nav";

export default async function SecuredLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCurrentUser();

  return (
    <>
      <ArenaNav pseudo={user.pseudo} avatarUrl={user.avatarUrl} />
      <main className="page-shell">{children}</main>
    </>
  );
}
