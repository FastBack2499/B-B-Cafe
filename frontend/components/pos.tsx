"use client";

import { useRef, useState } from "react";
import { ClipboardList, Minus, Plus, ReceiptText, ShoppingBag, Trash2 } from "lucide-react";
import { Blank, CategoryIcon, CategoryTabs, Feedback, Modal, NumericInput, RequestError, SearchBox, baseMoney, decimal, formatError, localDigits, money, normalized, numeric } from "./shared";
import type { Client, Currency, Menu, Order, Product } from "./shared";

type Props = { client: Client; menu: Menu; refreshMenu: () => Promise<void>; notify: (message: string) => void; showOrders: () => void };

const moneyScale = 10000n;

function orderUnits(amount: string) {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole + fraction.padEnd(4, "0"));
}

function orderMoney(units: bigint, currency: Currency) {
  return money((units / moneyScale) + "." + (units % moneyScale).toString().padStart(4, "0"), currency);
}

function calculateCheckout(subtotal: bigint, discount: string, percent: string, currency: Currency) {
  const fixed = baseMoney(discount, currency);
  const percentage = numeric(percent);
  if (percentage === "." || Number(percentage) > 100) throw new Error("تخفیف درصدی باید بین ۰ تا ۱۰۰ باشد.");
  const rate = orderUnits(percentage) / 100n;
  const percentageDiscount = (subtotal * rate + 5000n) / 10000n;
  const total = subtotal - (orderUnits(fixed) + percentageDiscount);
  if (total < 0n) throw new Error("مجموع تخفیف نمی‌تواند بیشتر از مبلغ سفارش باشد.");
  return { fixed, percentage, total };
}

export function PointOfSale({ client, menu, refreshMenu, notify, showOrders }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const items = menu.products.filter((p) => quantities[p.id] && p.price != null);
  const subtotal = items.reduce((total, p) => total + orderUnits(p.price ?? "0") * BigInt(quantities[p.id]), 0n);
  const count = items.reduce((n, p) => n + quantities[p.id], 0);
  const products = menu.products.filter((p) => (category === "all" || category === p.category) && normalized(p.name).includes(normalized(query)));
  let checkout: ReturnType<typeof calculateCheckout> | undefined;
  let discountError = "";
  try { checkout = calculateCheckout(subtotal, discount, discountPercent, menu.settings); }
  catch (error) { if (count) discountError = formatError(error); }

  function change(product: Product, changeBy: number) {
    if (product.price == null) return;
    setQuantities((q) => ({ ...q, [product.id]: Math.max(0, Math.min(999, (q[product.id] || 0) + changeBy)) }));
  }
  async function submit() {
    if (busy || !items.length || !checkout) return;
    setError("");
    setBusy(true);
    try {
      const data = {
        items: items.map((p) => ({ id: p.id, quantity: quantities[p.id], price: p.price })),
        note, discount: checkout.fixed, discount_percent: checkout.percentage,
      };
      const fingerprint = JSON.stringify(data);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
      const order = await client<Order>("/orders", "POST", { ...data, request_id: attempt.current.id });
      setQuantities({});
      setDiscount("");
      setDiscountPercent("");
      setNote("");
      setReviewOpen(false);
      attempt.current = null;
      notify("سفارش " + decimal(order.id) + " ثبت شد.");
    } catch (error) {
      setError(formatError(error));
      if (error instanceof RequestError && error.status === 409) {
        try { await refreshMenu(); } catch { /* Keep the original conflict visible. */ }
      }
    } finally { setBusy(false); }
  }
  const amount = checkout ? orderMoney(checkout.total, menu.settings) : "—";
  const clearOrder = <button className="button icon" type="button" disabled={!count || busy} aria-label="خالی کردن سفارش جاری" onClick={() => { setQuantities({}); setError(""); }}><Trash2 size={18} /></button>;
  const submitOrder = <button className="button primary full" type="button" disabled={!items.length || !checkout || busy} onClick={() => void submit()}><ReceiptText size={18} />{busy ? "در حال ثبت…" : "ثبت سفارش"}</button>;
  const orderTotal = <div className="cart-total"><span>مبلغ نهایی</span><strong>{amount} <small>{menu.settings.currency}</small></strong></div>;
  const orderDetails = <>
      {items.length ? <div className="cart-items">{items.map((p) => <div className="cart-line" key={p.id}>
        <div><strong>{localDigits(p.name)}</strong><small>{orderMoney(orderUnits(p.price ?? "0") * BigInt(quantities[p.id]), menu.settings)} {menu.settings.currency}</small></div>
        <div className="stepper">
          <button type="button" aria-label={"افزایش " + p.name} disabled={busy} onClick={() => change(p, 1)}><Plus size={15} /></button>
          <span>{decimal(quantities[p.id])}</span><button type="button" aria-label={"کاهش " + p.name} disabled={busy} onClick={() => change(p, -1)}><Minus size={15} /></button>
        </div>
      </div>)}</div> : <Blank title="سفارش خالی است" detail="از منو آیتمی انتخاب کنید." />}
      <div className="cart-fields">
        <label>یادداشت سفارش<input value={note} disabled={busy} maxLength={250} placeholder="مثلاً شماره میز" onChange={(event) => setNote(event.target.value)} /></label>
        <div className="cart-discounts">
          <label>تخفیف درصدی (٪)<NumericInput fractionDigits={2} value={discountPercent} disabled={busy} placeholder="۰" onValueChange={setDiscountPercent} /></label>
          <label>تخفیف ({menu.settings.currency})<NumericInput fractionDigits={4} grouped value={discount} disabled={busy} placeholder="۰" onValueChange={setDiscount} /></label>
        </div>
      </div>
  </>;

  return <div className="pos-layout">
    <section className="pos-menu">
      <div className="pos-banner"><span>نان و کره</span><h2>سفارش جدید</h2><p>آیتم‌ها را به سفارش اضافه کنید.</p></div>
      <div className="section-head"><div><h2>منوی کافه</h2><p>{decimal(products.length)} آیتم</p></div><SearchBox value={query} onChange={setQuery} /></div>
      <CategoryTabs options={menu.categories} active={category} onChange={setCategory} />
      <div className="pos-products" key={category}>
        {products.map((p) => <article key={p.id} className="pos-item">
          <CategoryIcon category={p.category} tile />
          <div className="pos-item-text"><h3>{localDigits(p.name)}</h3><span>{p.price == null ? "بدون قیمت" : money(p.price, menu.settings) + " " + menu.settings.currency}</span></div>
          <button className="button add-item icon" aria-label={"افزودن " + p.name} disabled={busy || p.price == null} onClick={() => change(p, 1)}><Plus size={20} /></button>
        </article>)}
      </div>
      {!products.length && <Blank title="آیتمی پیدا نشد" />}
    </section>
    <aside className="cart panel">
      <div className="cart-head"><span className="icon-tile sage"><ShoppingBag size={20} /></span><div><h2>سفارش جاری</h2><p>{decimal(count)} قلم</p></div>{clearOrder}</div>
      {orderDetails}
      {orderTotal}
      <Feedback error={discountError || error} />
      {submitOrder}
      <button className="button ghost full" onClick={showOrders}><ClipboardList size={17} /> سفارش‌های باز</button>
    </aside>
    {count > 0 && <section className="mobile-cart-bar" aria-label="ثبت سفارش جاری">
      {!reviewOpen && <Feedback error={discountError || error} />}
      <div className="mobile-cart-row">
        <button className="mobile-cart-summary" type="button" aria-haspopup="dialog" aria-expanded={reviewOpen} onClick={() => setReviewOpen(true)}>
          <ShoppingBag size={19} />
          <span><strong>مرور سفارش <small>· {decimal(count)} قلم</small></strong><span className="mobile-cart-amount">{amount} {menu.settings.currency}</span></span>
        </button>
        {submitOrder}
      </div>
    </section>}
    {reviewOpen && <Modal title="سفارش جاری" className="mobile-cart-sheet" close={() => setReviewOpen(false)}>
      <div className="mobile-cart-details">
        <div className="cart-head"><p>{decimal(count)} قلم</p>{clearOrder}</div>
        {orderDetails}
      </div>
      <div className="mobile-cart-actions">
        {orderTotal}
        <Feedback error={discountError || error} />
        {submitOrder}
      </div>
    </Modal>}
  </div>;
}
