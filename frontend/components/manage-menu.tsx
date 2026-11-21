"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, FlaskConical, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { Blank, CategoryIcon, Feedback, Modal, NumericInput, SearchBox, baseMoney, decimal, formatError, localDigits, money, normalized, numeric } from "./shared";
import type { Category, Client, Menu, Product, Recipe } from "./shared";

type Ingredient = { id: number; name: string; unit: string; unit_cost: string };
type Props = { client: Client; refreshMenu: () => Promise<void>; notify: (message: string) => void };

export function ManageMenu({ client, refreshMenu, notify }: Props) {
  const [data, setData] = useState<Menu>();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [tab, setTab] = useState<"products" | "categories" | "ingredients" | "currency">("products");
  const [category, setCategory] = useState<Category | null>(null);
  const [categoryToRemove, setCategoryToRemove] = useState<Category | null>(null);
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<Product | null>(null);
  const [material, setMaterial] = useState<Ingredient | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [menu, ingredients] = await Promise.all([client<Menu>("/manage/menu"), client<{ items: Ingredient[] }>("/manage/ingredients")]);
      setData(menu);
      setIngredients(ingredients.items);
    } catch (error) { setError(formatError(error)); }
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function saved(message: string) {
    setEdit(null);
    setMaterial(null);
    setCategory(null);
    setCategoryToRemove(null);
    await refresh();
    try { await refreshMenu(); } catch (error) { setError(formatError(error)); }
    notify(message);
  }

  const products = data?.products.filter((p) => normalized(p.name + " " + p.code + " " + p.category_name).includes(normalized(query))) || [];
  return <section className="workspace-page">
    <div className="section-head"><div><h2>مدیریت منو</h2><p>قیمت فروش، متریال و سود هر آیتم</p></div></div>
    <div className="toolbar" aria-label="بخش‌های مدیریت منو">
      <button className={"chip " + (tab === "products" ? "selected" : "")} onClick={() => setTab("products")}>آیتم‌ها</button>
      <button className={"chip " + (tab === "categories" ? "selected" : "")} onClick={() => setTab("categories")}><Layers size={17} /> دسته‌بندی‌ها</button>
      <button className={"chip " + (tab === "ingredients" ? "selected" : "")} onClick={() => setTab("ingredients")}><FlaskConical size={17} /> مواد اولیه</button>
      <button className={"chip " + (tab === "currency" ? "selected" : "")} onClick={() => setTab("currency")}><Coins size={17} /> واحد قیمت</button>
    </div>
    <Feedback error={error} />
    {!data ? error ? <button className="button soft" onClick={() => void refresh()}>تلاش دوباره</button> : <div className="skeleton" /> : <>
      {tab === "products" && <>
        <div className="section-head">
          <SearchBox value={query} onChange={setQuery} />
          <button className="button primary" onClick={() => setEdit({ id: 0, code: Math.max(0, ...data.products.map((p) => p.code)) + 1, name: "", description: "", category: data.categories[0]?.slug || "", category_name: "", price: null, active: true })}><Plus size={19} /> افزودن آیتم</button>
        </div>
        {products.length ? <div className="panel table-wrap">
          <table><thead><tr><th>آیتم</th><th>قیمت فروش ({data.settings.currency})</th><th>متریال ({data.settings.currency})</th><th>سود واحد ({data.settings.currency})</th><th>حاشیه سود</th><th>وضعیت</th><th>ویرایش</th></tr></thead><tbody>
            {products.map((p) => <tr key={p.id}>
              <td><span className="row-label"><CategoryIcon category={p.category} tile /><span><strong>{localDigits(p.name)}</strong><small>{p.category_name} · کد {decimal(p.code)}</small></span></span></td>
              <td>{money(p.price, data.settings)}</td><td>{money(p.effective_cost, data.settings)}</td>
              <td className={Number(p.profit) < 0 ? "negative" : ""}>{money(p.profit, data.settings)}</td>
              <td>{p.margin == null ? "—" : decimal(p.margin) + "٪"}</td>
              <td><span className={"status " + (p.active ? "paid" : "cancelled")}>{p.active ? "فعال" : "غیرفعال"}</span></td>
              <td><button className="button icon soft" aria-label={"ویرایش " + p.name} onClick={() => setEdit(p)}><Pencil size={17} /></button></td>
            </tr>)}
          </tbody></table>
        </div> : <Blank title="آیتمی پیدا نشد" />}
      </>}
      {tab === "categories" && <>
        <div className="toolbar"><button className="button primary" onClick={() => setCategory({
          slug: "", name: "", position: Math.max(-1, ...data.categories.map((row) => row.position)) + 1,
        })}><Plus size={19} /> افزودن دسته</button></div>
        {data.categories.length ? <div className="panel table-wrap"><table><thead><tr><th>دسته‌بندی</th><th>ترتیب نمایش</th><th>عملیات</th></tr></thead><tbody>
          {data.categories.map((row) => <tr key={row.slug}><td>{row.name}</td><td>{decimal(row.position)}</td><td><div className="table-actions">
            <button className="button icon soft" aria-label={"ویرایش " + row.name} onClick={() => setCategory(row)}><Pencil size={17} /></button>
            <button className="button icon danger" aria-label={"حذف " + row.name} onClick={() => setCategoryToRemove(row)}><Trash2 size={16} /></button>
          </div></td></tr>)}
        </tbody></table></div> : <Blank title="دسته‌ای ثبت نشده است" />}
      </>}
      {tab === "ingredients" && <>
        <div className="toolbar"><button className="button primary" onClick={() => setMaterial({ id: 0, name: "", unit: "", unit_cost: "" })}><Plus size={19} /> افزودن ماده</button></div>
        {ingredients.length ? <div className="panel table-wrap"><table><thead><tr><th>نام ماده</th><th>واحد</th><th>هزینه واحد ({data.settings.currency})</th><th>ویرایش</th></tr></thead><tbody>
          {ingredients.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td>{money(item.unit_cost, data.settings)}</td><td><button className="button icon soft" aria-label={"ویرایش " + item.name} onClick={() => setMaterial(item)}><Pencil size={17} /></button></td></tr>)}
        </tbody></table></div> : <Blank title="مادهٔ اولیه‌ای ثبت نشده است" detail="برای محاسبه هزینه از روی رسپی، مواد اولیه را وارد کنید." />}
      </>}
      {tab === "currency" && <div className="panel form-panel"><DataForm action={(form) => client("/manage/currency", "POST", { currency: form.get("currency"), multiplier: numeric(String(form.get("multiplier"))) })} saved={() => void saved("واحد قیمت ذخیره شد.")}>
        <p>عنوان و ضریب فقط شیوه نمایش قیمت را تغییر می‌دهند. مبالغ منو و متریال با واحد پایهٔ فایل ذخیره می‌شوند.</p>
        <div className="form-row"><label>عنوان واحد<input name="currency" defaultValue={data.settings.currency} maxLength={24} required /></label>
        <label>ضریب نمایش<NumericInput name="multiplier" defaultValue={data.settings.multiplier} required /></label></div>
      </DataForm></div>}
      {category && <Modal title={category.slug ? "ویرایش دسته" : "افزودن دسته"} close={() => setCategory(null)}>
        <DataForm action={(form) => client("/manage/categories" + (category.slug ? "/" + category.slug : ""), category.slug ? "PATCH" : "POST", {
          name: form.get("name"), position: numeric(String(form.get("position"))),
        })} saved={() => void saved("دسته‌بندی ذخیره شد.")}>
          <label>نام دسته<input name="name" defaultValue={category.name} maxLength={80} required /></label>
          <label>ترتیب نمایش<NumericInput name="position" defaultValue={category.position} required /></label>
        </DataForm>
      </Modal>}
      {categoryToRemove && <Modal title="حذف دسته‌بندی" close={() => setCategoryToRemove(null)}>
        <DataForm action={() => client("/manage/categories/" + categoryToRemove.slug, "DELETE")} saved={() => void saved("دسته‌بندی حذف شد.")} button="تأیید حذف">
          <p>دستهٔ «{categoryToRemove.name}» از منو حذف می‌شود.</p>
        </DataForm>
      </Modal>}
      {edit && <ProductDialog edit={edit} data={data} ingredients={ingredients} client={client} close={() => setEdit(null)} saved={() => void saved("آیتم منو ذخیره شد.")} />}
      {material && <Modal title={material.id ? "ویرایش ماده اولیه" : "افزودن ماده اولیه"} close={() => setMaterial(null)}>
        <DataForm action={(form) => client("/manage/ingredients" + (material.id ? "/" + material.id : ""), material.id ? "PATCH" : "POST", {
          name: form.get("name"), unit: form.get("unit"), cost: baseMoney(String(form.get("cost")), data.settings),
        })} saved={() => void saved("ماده اولیه ذخیره شد.")}>
          <label>نام ماده<input name="name" defaultValue={material.name} required maxLength={100} /></label>
          <label>واحد اندازه‌گیری<input name="unit" placeholder="گرم، میلی‌لیتر یا عدد" defaultValue={material.unit} required maxLength={32} /></label>
          <label>هزینهٔ یک واحد ({data.settings.currency})<NumericInput name="cost" fractionDigits={4} grouped defaultValue={material.unit_cost ? money(material.unit_cost, data.settings) : ""} required /></label>
        </DataForm>
      </Modal>}
    </>}
  </section>;
}

function ProductDialog({ edit, data, ingredients, client, close, saved }: { edit: Product; data: Menu; ingredients: Ingredient[]; client: Client; close: () => void; saved: () => void }) {
  const [recipe, setRecipe] = useState<Recipe[]>(edit.recipe || []);
  const [ingredient, setIngredient] = useState("");
  const available = ingredients.filter((item) => !recipe.some((entry) => entry.ingredient === item.id));
  function setQuantity(id: number, quantity: string) {
    setRecipe(recipe.map((entry) => entry.ingredient === id ? { ...entry, quantity } : entry));
  }
  return <Modal title={edit.id ? "ویرایش آیتم منو" : "افزودن آیتم منو"} close={close}>
    <DataForm action={(form) => client("/manage/menu" + (edit.id ? "/" + edit.id : ""), edit.id ? "PATCH" : "POST", {
      code: numeric(String(form.get("code"))), name: form.get("name"), category: form.get("category"), description: form.get("description"),
      price: baseMoney(String(form.get("price")), data.settings), cost: baseMoney(String(form.get("cost")), data.settings), active: form.get("active") === "on",
      recipe: recipe.map((entry) => ({ ...entry, quantity: numeric(entry.quantity) })),
    })} saved={saved}>
      <div className="form-row"><label>نام آیتم<input name="name" defaultValue={edit.name} required maxLength={150} /></label>
        <label>کد آیتم<NumericInput name="code" defaultValue={edit.code} required /></label></div>
      <label>دسته‌بندی<select name="category" defaultValue={edit.category} required>{data.categories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}</select></label>
      <div className="form-row">
        <label>قیمت ({data.settings.currency})<NumericInput name="price" fractionDigits={4} grouped defaultValue={edit.price == null ? "" : money(edit.price, data.settings)} /></label>
        <label>متریال مستقیم ({data.settings.currency})<NumericInput name="cost" fractionDigits={4} grouped defaultValue={edit.cost == null ? "" : money(edit.cost, data.settings)} /></label>
      </div>
      <label>توضیح منوی عمومی<textarea name="description" rows={2} maxLength={300} defaultValue={edit.description} /></label>
      <label className="check-label"><input type="checkbox" name="active" defaultChecked={edit.active} /> نمایش در منو</label>
      <div className="recipe">
        <h3>رسپی و مقدار مصرف</h3>
        <p>با ثبت رسپی، هزینه متریال از مقدار مصرف و قیمت مواد اولیه محاسبه می‌شود.</p>
        {recipe.map((entry) => {
          const material = ingredients.find((item) => item.id === entry.ingredient);
          return <div className="inline-form" key={entry.ingredient}>
            <label>{material?.name} ({material?.unit})<NumericInput fractionDigits={6} required value={entry.quantity} onValueChange={(value) => setQuantity(entry.ingredient, value)} /></label>
            <button className="button icon danger" type="button" aria-label={"حذف " + material?.name} onClick={() => setRecipe(recipe.filter((row) => row.ingredient !== entry.ingredient))}><Trash2 size={17} /></button>
          </div>;
        })}
        {available.length > 0 && <div className="inline-form"><label>مادهٔ اولیه<select value={ingredient} onChange={(event) => setIngredient(event.target.value)}><option value="">انتخاب ماده</option>
          {available.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <button type="button" className="button soft" disabled={!ingredient} onClick={() => { setRecipe([...recipe, { ingredient: Number(ingredient), quantity: "" }]); setIngredient(""); }}><Plus size={17} /> افزودن</button></div>}
      </div>
    </DataForm>
  </Modal>;
}

export function DataForm({ action, saved, children, button = "ذخیره" }: { action: (form: FormData) => Promise<unknown>; saved: () => void; children: React.ReactNode; button?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="form-grid" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try { await action(form); saved(); }
    catch (error) { setError(formatError(error)); }
    finally { setBusy(false); }
  }}>{children}<Feedback error={error} /><button className="button primary" disabled={busy}>{busy ? "در حال ذخیره…" : button}</button></form>;
}
