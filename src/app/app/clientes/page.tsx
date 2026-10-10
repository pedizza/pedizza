import { ResourceManager } from "@/components/resource-manager";
import { archivePermission } from "@/lib/modules/service";
import { requirePage } from "@/lib/auth/context";

export default async function Page() {
  const ctx = await requirePage("customers.view");
  return (
    <div className="module-workspace">
      <ResourceManager
        resourceKey="clientes"
        canEdit={ctx.permissions.includes("customers.edit")}
        canArchive={ctx.permissions.includes(archivePermission("clientes"))}
      />
    </div>
  );
}
