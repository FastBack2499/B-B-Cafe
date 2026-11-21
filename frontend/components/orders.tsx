"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, CircleCheck, Printer, ReceiptText, X } from "lucide-react";
import { Blank, Feedback, Modal, NumericInput, SearchBox, baseMoney, decimal, formatError, localDigits, money, numeric, shamsi } from "./shared";
import type { Client, Currency, Order } from "./shared";

type Closure = { action: "one" | "first" | "all"; status: "paid" | "cancelled"; id?: number; request_id: string };
type Data = { orders: Order[]; more: boolean };
const payments = { card: "کارت‌خوان", cash: "نقدی", transfer: "انتقال بانکی", other: "ثبت نشده" };
const statuses = { open: "در انتظار", paid: "تسویه‌شده", cancelled: "لغوشده" };
const orderLabel = (order: Order) => order.legacy_number ? localDigits(order.legacy_number.replace(/^Order #/, "سفارش ")) : "سفارش " + decimal(order.id);

export function Orders({ history, owner, client, currency, notify }: { history: boolean; owner: boolean; client: Client; currency: Currency; notify: (message: string) => void }) {
  const [data, setData] = useState<Data>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Order | null>(null);
  const [closure, setClosure] = useState<Closure | null>(null);
  const [payment, setPayment] = useState("card");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++latest.current;
    try {
      const next = await client<Data>("/orders?" + new URLSearchParams({ status: history ? "history" : "open", q: numeric(search), page: String(page) }));
      if (sequence === latest.current) { setData(next); setError(""); }
      return next;
    } catch (error) {
      if (sequence === latest.current) setError(formatError(error));
      return null;
    }
  }, [client, history, page, search]);

  useEffect(() => {
    const delay = setTimeout(() => void refresh(), search ? 180 : 0);
    const timer = history ? undefined : setInterval(() => { if (!document.hidden) void refresh(); }, 8000);
    return () => { ++latest.current; clearTimeout(delay); clearInterval(timer); };
  }, [refresh, history, search]);

  function confirm(next: Omit<Closure, "request_id">) {
    setActionError("");
    setClosure({ ...next, request_id: crypto.randomUUID() });
  }

  function setMethod(value: string) {
    setPayment(value);
    setClosure((current) => current && ({ ...current, request_id: crypto.randomUUID() }));
  }

  async function closeOrders() {
    if (!closure || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await client<{ closed: number }>("/orders/close", "POST", { ...closure, payment });
      setClosure(null);
      setDetail(null);
      await refresh();
      notify(result.closed ? decimal(result.closed) + (closure.status === "paid" ? " سفارش تسویه شد." : " سفارش لغو شد.") : "سفارش بازی وجود ندارد.");
    } catch (error) { setActionError(formatError(error)); }
    finally { setBusy(false); }
  }

  async function completeCost(line: number, amount: string) {
    setBusy(true);
    setActionError("");
    try {
      const cost = baseMoney(amount, currency);
      await client("/lines/" + line + "/cost", "PATCH", { cost });
      const order = detail;
      if (order) setDetail({ ...order, items: order.items.map((item) => item.id === line ? { ...item, cost } : item) });
      await refresh();
      notify("هزینه متریال ثبت شد.");
    } catch (error) { setActionError(formatError(error)); }
    finally { setBusy(false); }
  }

  return <section className="workspace-page">
    <div className="section-head"><div><h2>{history ? "بایگانی سفارش‌ها" : "صف سفارش‌ها"}</h2><p>{history ? "فاکتورهای تسویه‌شده و لغوشده" : "سفارش‌ها به ترتیب ثبت نمایش داده می‌شوند."}</p></div>
      <SearchBox value={search} onChange={(value) => { setPage(1); setSearch(value); }} placeholder="جستجوی سفارش یا آیتم…" />
    </div>
    {!history && !search && page === 1 && !!data?.orders.length && <div className="toolbar">
      <button className="button primary" onClick={() => confirm({ action: "first", status: "paid", id: data.orders[0].id })}><CircleCheck size={17} /> تسویه اولین سفارش</button>
      {owner && <button className="button soft" onClick={() => confirm({ action: "all", status: "paid" })}>تسویه همه</button>}
      {owner && <button className="button danger" onClick={() => confirm({ action: "all", status: "cancelled" })}>لغو همه</button>}
    </div>}
    <Feedback error={error} />
    {error && <button className="button soft" onClick={() => void refresh()}>تلاش دوباره</button>}
    {data ? data.orders.length ? <div className="order-grid">
      {data.orders.map((order) => <article key={order.id} className="panel order-card">
        <header><span className="icon-tile sage"><ReceiptText size={19} /></span><div><h3>{orderLabel(order)}</h3><small><CalendarClock size={14} />{shamsi(order.closed || order.created, true)}</small></div><span className={"status " + order.status}>{statuses[order.status]}</span></header>
        <p>{order.items.map((item) => localDigits(item.name) + " × " + decimal(item.quantity)).join("، ")}</p>
        {order.note && <small>{order.note}</small>}
        <footer><strong>{money(order.total, currency)} <small>{currency.currency}</small></strong><button className="button soft" onClick={() => { setActionError(""); setDetail(order); }}>جزئیات فاکتور</button></footer>
      </article>)}
    </div> : <Blank title={search ? "سفارشی پیدا نشد" : history ? "تاریخچه خالی است" : "هیچ سفارش بازی وجود ندارد"} /> :
      !error && <div className="skeleton" aria-label="در حال بارگذاری" />}
    {(page > 1 || data?.more) && <div className="toolbar pagination">
      <button className="button soft" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronRight size={16} /> قبلی</button><span>{decimal(page)}</span>
      <button className="button soft" disabled={!data?.more} onClick={() => setPage(page + 1)}>بعدی <ChevronLeft size={16} /></button>
    </div>}
    {detail && !closure && <Modal title={orderLabel(detail)} close={() => setDetail(null)}>
      <div className="receipt">
        <p>{shamsi(detail.closed || detail.created, true)} · {statuses[detail.status]}{detail.creator && " · " + detail.creator}</p>
        {detail.payment && <p>روش پرداخت {payments[detail.payment as keyof typeof payments]}</p>}
        {detail.note && <p>{detail.note}</p>}
        {detail.items.map((item) => <div key={item.id} className="receipt-row">
          <strong>{localDigits(item.name)}</strong><span>{decimal(item.quantity)} × {money(item.price, currency)}</span><b>{money(item.line_total, currency)} {currency.currency}</b>
          {owner && detail.status === "paid" && item.cost === null && <form className="inline-form" onSubmit={(event) => {
            event.preventDefault(); void completeCost(item.id, String(new FormData(event.currentTarget).get("cost")));
          }}><label>هزینه واحد متریال ({currency.currency})<NumericInput name="cost" fractionDigits={4} grouped required /></label><button className="button soft" disabled={busy}>ذخیره هزینه</button></form>}
        </div>)}
        <div className="receipt-row"><span>جمع</span><strong>{money(detail.subtotal, currency)} {currency.currency}</strong></div>
        {Number(detail.discount) > 0 && <div className="receipt-row"><span>تخفیف</span><b>{money(detail.discount, currency)}</b></div>}
        <div className="receipt-row"><strong>مبلغ نهایی</strong><strong>{money(detail.total, currency)} {currency.currency}</strong></div>
      </div>
      <Feedback error={actionError} />
      <div className="toolbar no-print"><button className="button soft" onClick={() => window.print()}><Printer size={17} /> چاپ فاکتور</button>
        {detail.status === "open" && <><button className="button primary" onClick={() => confirm({ action: "one", status: "paid", id: detail.id })}>تسویه سفارش</button>
          <button className="button danger" onClick={() => confirm({ action: "one", status: "cancelled", id: detail.id })}><X size={16} /> لغو سفارش</button></>}
      </div>
    </Modal>}
    {closure && <Modal title={closure.status === "paid" ? "تأیید تسویه" : "تأیید لغو"} close={() => { if (!busy) setClosure(null); }}>
      <div className="form-grid">
        <p>{closure.action === "all" ? "این عملیات روی همهٔ سفارش‌های باز انجام می‌شود." : closure.action === "first" ? "این عملیات روی اولین سفارش باز انجام می‌شود." : "تغییر وضعیت این سفارش را تأیید کنید."}</p>
        {closure.status === "paid" && <label>روش پرداخت<select value={payment} disabled={busy} onChange={(event) => setMethod(event.target.value)}>
          {Object.entries(payments).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>}
        <Feedback error={actionError} />
        <button className={"button " + (closure.status === "paid" ? "primary" : "danger")} disabled={busy} onClick={() => void closeOrders()}>{busy ? "در حال انجام…" : "تأیید"}</button>
      </div>
    </Modal>}
  </section>;
}
