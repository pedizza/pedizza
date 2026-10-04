import { requirePage } from "@/lib/auth/context";
import { TeamManager } from "@/components/team-manager";
import { PageHeader } from "@/components/ui/states";
export default async function Page() {
  const ctx = await requirePage("team.view");
  return (
    <>
      <PageHeader
        title="Equipe"
        description="As pessoas que fazem sua pizzaria acontecer."
      />
      <TeamManager permissions={ctx.permissions} />
    </>
  );
}
