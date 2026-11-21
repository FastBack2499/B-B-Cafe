"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Coffee, Menu as MenuIcon } from "lucide-react";
import { Blank, Brand, CategoryIcon, CategoryTabs, Feedback, SearchBox, formatError, localDigits, money, normalized, request } from "./shared";
import type { Menu } from "./shared";
import { InstallButton } from "./pwa";

export function PublicMenu() {
  const [menu, setMenu] = useState<Menu>();
  const [error, setError] = useState("");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  async function refresh() {
    setError("");
    try { setMenu(await request<Menu>("/api/menu")); }
    catch (error) { setError(formatError(error)); }
  }
  useEffect(() => { void refresh(); }, []);

  const filtered = menu?.products.filter((item) => (category === "all" || item.category === category) &&
    normalized(item.name + " " + item.description).includes(normalized(query))) || [];

  return <>
    <header className="site-header"><div className="public-width header-content">
      <a href="/" className="brand-link" aria-label="کافه نان و کره"><Brand /></a>
      <nav className="site-nav"><a href="#menu"><MenuIcon size={16} /> منوی کافه</a></nav>
      <InstallButton />
    </div></header>
    <main className="public-width">
      <section className="hero">
        <div className="hero-inner">
          <p className="hero-tag"><Coffee size={16} /> کافه نان و کره</p>
          <h1>منوی کافه</h1>
          <p className="hero-copy">قهوه، نوشیدنی و نان تازه</p>
          <a className="button hero-button" href="#menu">دیدن منو <ChevronDown size={17} /></a>
        </div>
      </section>
      <section className="menu-section" id="menu" aria-labelledby="menu-title">
        <div className="section-head">
          <div><h2 id="menu-title">آیتم‌های منو</h2><p>دسته‌بندی دلخواهتان را انتخاب کنید.</p></div>
          <SearchBox value={query} onChange={setQuery} />
        </div>
        {menu && <CategoryTabs options={menu.categories} active={category} onChange={setCategory} />}
        {error ? <div className="retry-box"><Feedback error={error} /><button className="button soft" onClick={() => void refresh()}>تلاش دوباره</button></div>
          : !menu ? <div className="menu-grid" aria-busy="true" aria-label="در حال بارگذاری منو">{Array.from({ length: 6 }, (_, index) => <div className="skeleton" key={index} />)}</div>
            : filtered.length ? <div className="menu-grid" key={category}>
              {filtered.map((product) => <article className="product-card" key={product.id}>
                <div className="product-top"><CategoryIcon category={product.category} tile /><span>{product.category_name}</span></div>
                <h3>{localDigits(product.name)}</h3>
                {product.description && <p className="product-description">{product.description}</p>}
                <div className="product-price">{product.price == null ? <small>قیمت اعلام نشده</small> :
                  <><strong>{money(product.price, menu.settings)}</strong>{" "}<span>{menu.settings.currency}</span></>}</div>
              </article>)}
            </div> : <Blank title="آیتمی پیدا نشد" detail={query ? "واژهٔ دیگری را امتحان کنید." : "در این دسته‌بندی هنوز آیتمی ثبت نشده است."} />}
      </section>
    </main>
    <footer className="site-footer"><div className="public-width"><Brand /><a href="#menu">منوی کافه</a></div></footer>
  </>;
}
