import { archivePermission, listResource } from "@/lib/modules/service";
import Link from "next/link";
import { requirePage } from "@/lib/auth/context";
import { resources } from "@/lib/modules/registry";
import { ResourceManager } from "./resource-manager";
import { BusinessHoursManager } from "./business-hours-manager";
import { PageHeader } from "./ui/states";
export async function ModulePage({
  title,
  description,
  tabs,
  selected,
  hideHeader = false,
  groups,
  tabGuidance,
}: {
  title: string;
  description: string;
  tabs: { key: string; label: string; href?: string }[];
  selected: string;
  hideHeader?: boolean;
  groups?: { label: string; keys: string[] }[];
  tabGuidance?: Record<string, { title: string; description: string }>;
}) {
  const available = tabs.filter((t) => resources[t.key]);
  const key = available.some((t) => t.key === selected)
    ? selected
    : available[0].key;
  const resource = resources[key];
  const ctx = await requirePage(resource.read);
  const initialData =
    key === "horarios" ? undefined : await listResource(ctx, key, 1, "");
  const visibleTabs = tabs.filter(
    (t) => !resources[t.key] || ctx.permissions.includes(resources[t.key].read),
  );
  const activeGroup = groups?.find((group) => group.keys.includes(key));
  const sectionTabs = activeGroup
    ? visibleTabs.filter((tab) => activeGroup.keys.includes(tab.key))
    : visibleTabs;
  return (
    <div
      className={`module-workspace ${title === "Configurações" ? "module-settings" : ""}`}
    >
      {!hideHeader && <PageHeader title={title} description={description} />}
      {groups && (
        <nav className="tabs" aria-label="Seções do cardápio">
          {groups.map((group) => {
            const first = visibleTabs.find((tab) =>
              group.keys.includes(tab.key),
            );
            if (!first) return null;
            return (
              <Link
                key={group.label}
                className={`tab ${group === activeGroup ? "active" : ""}`}
                aria-current={group === activeGroup ? "true" : undefined}
                href={`?tab=${first.key}`}
              >
                {group.label}
              </Link>
            );
          })}
        </nav>
      )}
      {(!groups || sectionTabs.length > 1) && (
        <nav
          className="tabs"
          aria-label={groups ? `Opções de ${activeGroup?.label}` : "Seções"}
        >
          {sectionTabs.map((t) => (
            <Link
              className={`tab ${key === t.key ? "active" : ""}`}
              aria-current={key === t.key ? "page" : undefined}
              key={t.key}
              href={t.href || `?tab=${t.key}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {tabGuidance?.[key] && (
        <aside className="module-tab-guidance">
          <strong>{tabGuidance[key].title}</strong>
          <p>{tabGuidance[key].description}</p>
        </aside>
      )}
      {key === "horarios" ? (
        <BusinessHoursManager
          key={key}
          canEdit={ctx.permissions.includes(resource.write)}
        />
      ) : (
        <ResourceManager
          key={key}
          resourceKey={key}
          initialData={initialData}
          canEdit={ctx.permissions.includes(resource.write)}
          canArchive={
            key !== "regras-precos" &&
            ctx.permissions.includes(archivePermission(key))
          }
        />
      )}
    </div>
  );
}
