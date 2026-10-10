import { ResourceManager } from "@/components/resource-manager";
import { archivePermission, listResource } from "@/lib/modules/service";
import { requirePage } from "@/lib/auth/context";

export default async function Page() {
  const ctx = await requirePage("customers.view");
  const initialData = await listResource(ctx, "clientes", 1, "");
  return (
    <div className="module-workspace">
      <ResourceManager
        resourceKey="clientes"
        initialData={initialData}
        canEdit={ctx.permissions.includes("customers.edit")}
        canArchive={ctx.permissions.includes(archivePermission("clientes"))}
      />
    </div>
  );
}
