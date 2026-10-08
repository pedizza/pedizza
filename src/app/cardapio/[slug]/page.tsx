import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { one, rows, transaction } from "@/lib/db";
import {
  PublicMenuBrowser,
  type PublicCategory,
  type PublicMenuItem,
} from "@/components/public-menu-browser";

type Store = {
  display_name: string;
  public_menu_slug: string;
  logo_path: string | null;
};
const loadMenu = cache(async (slug: string) =>
  transaction(async (db) => {
    const store = await one<Store>(
      db,
      "select display_name,public_menu_slug,logo_path from public.store_settings where public_menu_slug=$1 and public_menu_enabled",
      [slug],
    );
    if (!store) return null;
    const categories = await rows<
      PublicCategory & { image_path: string | null }
    >(
      db,
      `select c.id,c.name,c.description,c.image_path from public.menu_categories c
     where c.tenant_id=(select tenant_id from public.store_settings where public_menu_slug=$1)
       and c.active and c.archived_at is null
       and exists(select 1 from public.menu_items i where i.tenant_id=c.tenant_id and i.category_id=c.id and i.active and i.available and i.archived_at is null)
     order by c.sort_order,c.name,c.id`,
      [slug],
    );
    const items = await rows<
      PublicMenuItem & { category_id: string; image_path: string | null }
    >(
      db,
      `select i.id,i.category_id,i.name,i.description,i.image_path from public.menu_items i
     join public.menu_categories c on c.tenant_id=i.tenant_id and c.id=i.category_id
     where i.tenant_id=(select tenant_id from public.store_settings where public_menu_slug=$1)
       and i.active and i.available and i.archived_at is null and c.active and c.archived_at is null
     order by c.sort_order,c.name,i.sort_order,i.name,i.id`,
      [slug],
    );
    return {
      store: {
        name: store.display_name,
        logoUrl: store.logo_path
          ? `/api/public/menu/${encodeURIComponent(slug)}/images/logo/logo`
          : null,
      },
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        imageUrl: category.image_path
          ? `/api/public/menu/${encodeURIComponent(slug)}/images/category/${category.id}`
          : null,
        products: items
          .filter((item) => item.category_id === category.id)
          .map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            imageUrl: item.image_path
              ? `/api/public/menu/${encodeURIComponent(slug)}/images/product/${item.id}`
              : null,
          })),
      })),
    };
  }),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadMenu(slug);
  return data
    ? {
        title: `Cardápio · ${data.store.name}`,
        description: `Conheça os produtos de ${data.store.name}.`,
        robots: { index: true, follow: true },
      }
    : {
        title: "Cardápio não encontrado",
        robots: { index: false, follow: false },
      };
}

export default async function PublicMenuPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadMenu(slug);
  if (!data) notFound();
  return <PublicMenuBrowser store={data.store} categories={data.categories} />;
}
