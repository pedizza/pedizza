import { archivePermission } from "@/lib/modules/service";
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
}: {
  title: string;
  description: string;
  tabs: { key: string; label: string; href?: string }[];
  selected: string;
  hideHeader?: boolean;
  groups?: { label: string; keys: string[] }[];
}) {
  const available = tabs.filter((t) => resources[t.key]);
  const key = available.some((t) => t.key === selected)
    ? selected
    : available[0].key;
  const resource = resources[key];
  const ctx = await requirePage(resource.read);
  const visibleTabs = tabs.filter(
    (t) => !resources[t.key] || ctx.permissions.includes(resources[t.key].read),
  );
  const activeGroup = groups?.find((group) => group.keys.includes(key));
  const sectionTabs = activeGroup
    ? visibleTabs.filter((tab) => activeGroup.keys.includes(tab.key))
    : visibleTabs;
  return (
    <>
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
                prefetch={false}
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
              prefetch={false}
            >
              {t.label}
            </Link>
          ))}
        </nav>
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
          canEdit={ctx.permissions.includes(resource.write)}
          canArchive={
            key !== "regras-precos" &&
            ctx.permissions.includes(archivePermission(key))
          }
        />
      )}
    </>
  );
}
