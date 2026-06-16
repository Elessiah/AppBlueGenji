import { requireCurrentUser } from "@/lib/server/auth";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { ArenaNav } from "@/components/arena-nav";

export default async function SecuredLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCurrentUser();
  const activeTeam = await getUserActiveTeam(user.id);

  return (
    <>
      <ArenaNav pseudo={user.pseudo} avatarUrl={user.avatarUrl} activeTeam={activeTeam} />
      <main className="page-shell">{children}</main>
    </>
  );
}
