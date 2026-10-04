import { archivePermission } from "@/lib/modules/service";
import Link from "next/link";
import { requirePage } from "@/lib/auth/context";
import { resources } from "@/lib/modules/registry";
import { ResourceManager } from "./resource-manager";
import { PageHeader } from "./ui/states";
export async function ModulePage({
  title,
  description,
  tabs,
  selected,
}: {
  title: string;
  description: string;
  tabs: { key: string; label: string; href?: string }[];
  selected: string;
}) {
  const available = tabs.filter((t) => resources[t.key]);
  const key = available.some((t) => t.key === selected)
    ? selected
    : available[0].key;
  const resource = resources[key];
  const ctx = await requirePage(resource.read);
  return (
    <>
      <PageHeader title={title} description={description} />
      <nav className="tabs" aria-label="Seções">
        {tabs
          .filter(
            (t) =>
              !resources[t.key] ||
              ctx.permissions.includes(resources[t.key].read),
          )
          .map((t) => (
            <Link
              className={`tab ${key === t.key ? "active" : ""}`}
              key={t.key}
              href={t.href || `?tab=${t.key}`}
            >
              {t.label}
            </Link>
          ))}
      </nav>
      <ResourceManager
        key={key}
        resourceKey={key}
        canEdit={ctx.permissions.includes(resource.write)}
        canArchive={ctx.permissions.includes(archivePermission(key))}
      />
    </>
  );
}
