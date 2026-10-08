"use client";
import Image from "next/image";
import { useState } from "react";
import { ArrowLeft, ArrowRight, UtensilsCrossed } from "lucide-react";

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
};
export type PublicCategory = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  products: PublicMenuItem[];
};

export function PublicMenuBrowser({
  store,
  categories,
}: {
  store: { name: string; logoUrl: string | null };
  categories: PublicCategory[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const category = categories.find((entry) => entry.id === selected);
  return (
    <main className="public-menu">
      <header className="public-menu-header">
        <div className="public-menu-brand">
          {store.logoUrl ? (
            <Image
              src={store.logoUrl}
              alt={`Logo ${store.name}`}
              width={58}
              height={58}
              unoptimized
            />
          ) : (
            <span className="public-menu-mark">
              <UtensilsCrossed size={24} />
            </span>
          )}
          <div>
            <span>CARDÁPIO</span>
            <strong>{store.name}</strong>
          </div>
        </div>
        <span className="public-menu-live">
          <i /> Cardápio da loja
        </span>
      </header>
      <section className="public-menu-content">
        {category ? (
          <>
            <button
              className="public-menu-back"
              onClick={() => setSelected(null)}
            >
              <ArrowLeft size={17} /> Todas as categorias
            </button>
            <div className="public-menu-heading">
              <span className="public-menu-kicker">CARDÁPIO DA CASA</span>
              <h1>{category.name}</h1>
              {category.description && <p>{category.description}</p>}
              <span className="public-menu-count">
                {category.products.length}{" "}
                {category.products.length === 1 ? "produto" : "produtos"}
              </span>
            </div>
            <div className="public-product-grid">
              {category.products.map((product) => (
                <article className="public-product-card" key={product.id}>
                  {product.imageUrl ? (
                    <Image
                      className="public-product-image"
                      src={product.imageUrl}
                      alt={product.name}
                      width={480}
                      height={320}
                      unoptimized
                    />
                  ) : (
                    <div className="public-product-placeholder">
                      <UtensilsCrossed size={27} />
                    </div>
                  )}
                  <div className="public-product-copy">
                    <h2>{product.name}</h2>
                    {product.description && <p>{product.description}</p>}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="public-menu-heading">
              <span className="public-menu-kicker">
                FEITO COM CARINHO, NA {store.name.toLocaleUpperCase("pt-BR")}
              </span>
              <h1>Escolha uma categoria</h1>
              <p>Explore nossos sabores e encontre seu próximo favorito.</p>
            </div>
            {categories.length ? (
              <div className="public-category-grid">
                {categories.map((entry) => (
                  <button
                    className="public-category-card"
                    key={entry.id}
                    onClick={() => setSelected(entry.id)}
                  >
                    {entry.imageUrl ? (
                      <Image
                        src={entry.imageUrl}
                        alt=""
                        width={240}
                        height={160}
                        unoptimized
                      />
                    ) : (
                      <span className="public-category-icon">
                        <UtensilsCrossed size={23} />
                      </span>
                    )}
                    <span className="public-category-copy">
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.products.length}{" "}
                        {entry.products.length === 1 ? "produto" : "produtos"}
                      </small>
                      <span>
                        {entry.description || "Ver produtos"}
                        <ArrowRight size={15} />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="public-menu-empty">
                <UtensilsCrossed size={27} />
                <strong>Cardápio em preparação</strong>
                <span>Esta pizzaria ainda está organizando seus produtos.</span>
              </div>
            )}
          </>
        )}
      </section>
      <footer className="public-menu-footer">
        <span>{store.name}</span>
        <span>Cardápio digital</span>
        <span className="public-menu-powered">
          Feito com <b>Pedizza</b>
        </span>
      </footer>
    </main>
  );
}
