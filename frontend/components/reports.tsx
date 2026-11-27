"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, CalendarDays, Coins, Pencil, Plus, Target, Trash2, TrendingUp, Wallet } from "lucide-react";
import { Blank, DateInput, Feedback, Modal, NumericInput, baseMoney, decimal, formatError, localDigits, money, numeric, persianDate } from "./shared";
import type { Client, Currency } from "./shared";
import { DataForm } from "./manage-menu";
import { ManualSaleForm } from "./manual-sale";
import type { ManualSaleRecord } from "./manual-sale";

const months = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
type Common = { client: Client; prefix: string; notify: (message: string) => void };
type Range = { start: string; end: string };
type SalesReport = Range & {
  sales: string; profit: string | null; target: string | null; progress: string | null; orders: number;
  quantity: number; missing: number; products: { name: string; quantity: number; sales: string; material: string; missing: number }[];
  targets: (Range & { amount: string })[]; manual: ManualSaleRecord[]; manual_total: string;
};

function Stat({ icon, name, value, description }: { icon: React.ReactNode; name: string; value: React.ReactNode; description?: string }) {
  return <div className="panel stat"><span className="icon-tile sage">{icon}</span><p>{name}</p><strong>{value}</strong>{description && <small>{description}</small>}</div>;
}

export function Sales({ client, prefix, currency, notify }: Common & { currency: Currency }) {
  const [data, setData] = useState<SalesReport>();
  const [range, setRange] = useState<Range>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(false);
  const [manual, setManual] = useState<ManualSaleRecord | null>(null);
  const [remove, setRemove] = useState<ManualSaleRecord | null>(null);

  const refresh = useCallback(async (selection?: Range) => {
    setBusy(true); setError("");
    try {
      const suffix = selection ? "?" + new URLSearchParams({ start: selection.start, end: selection.end }) : "";
      setData(await client<SalesReport>("/reports/sales" + suffix));
      setRange(selection);
    } catch (error) { setError(formatError(error)); }
    finally { setBusy(false); }
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);

  function saved(message: string) {
    setTarget(false); setManual(null); setRemove(null);
    void refresh(range); notify(message);
  }

  const ratio = data?.progress == null ? null : Number(data.progress);
  const maxQuantity = Math.max(1, ...(data?.products.map((item) => item.quantity) || []));
  const rangeKey = data ? data.start + "/" + data.end : "";
  return <section className="workspace-page">
    <div className="section-head"><div><h2>حساب ماه</h2><p>فروش تسویه‌شده و سود پس از کسر متریال</p></div>
      {data && <a className="button soft" href={prefix + "/export/sales?" + new URLSearchParams({ start: data.start, end: data.end })}><ArrowDownToLine size={17} /> خروجی اکسل (CSV)</a>}</div>
    <Feedback error={error} />
    {!data ? error ? <button className="button soft" onClick={() => void refresh()}>تلاش دوباره</button> : <div className="skeleton" /> : <>
      <div className="panel filter-panel">
        <form key={rangeKey} className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void refresh({ start: String(form.get("start")), end: String(form.get("end")) });
        }}>
          <DateInput name="start" label="از تاریخ شمسی" value={persianDate(data.start)} />
          <DateInput name="end" label="تا تاریخ شمسی" value={persianDate(data.end)} />
          <button className="button primary" disabled={busy}><CalendarDays size={18} /> نمایش بازه</button>
        </form>
        <div className="toolbar">
          <button className="button soft" disabled={busy} onClick={() => void refresh()}>ماه جاری</button>
          <button className="button soft" disabled={busy} onClick={() => {
            const today = persianDate();
            void refresh({ start: today, end: today });
          }}>امروز</button>
          {!!data.targets.length && <label className="compact-label">بازه‌های دارای هدف<select value={data.targets.some((t) => t.start + "/" + t.end === rangeKey) ? rangeKey : ""} disabled={busy} onChange={(event) => {
            if (!event.target.value) return;
            const [start, end] = event.target.value.split("/");
            void refresh({ start, end });
          }}><option value="">انتخاب بازه</option>{data.targets.map((row) => <option key={row.start + row.end} value={row.start + "/" + row.end}>{persianDate(row.start)} تا {persianDate(row.end)}</option>)}</select></label>}
        </div>
      </div>
      <div className="stat-grid">
        <Stat icon={<Wallet size={20} />} name="فروش خالص" value={money(data.sales, currency)} description={currency.currency} />
        <Stat icon={<TrendingUp size={20} />} name="سود ناخالص" value={data.profit == null ? "ناقص" : money(data.profit, currency)} description={data.missing ? decimal(data.missing) + " قلم بدون هزینه متریال" : currency.currency} />
        <Stat icon={<Coins size={20} />} name="تعداد اقلام فروخته‌شده" value={decimal(data.quantity)} description={decimal(data.orders) + " سفارش تسویه‌شده"} />
      </div>
      <div className="report-grid">
        <section className="panel report-panel target-panel">
          <div className="section-head"><h3>هدف فروش</h3><button className="button soft" onClick={() => setTarget(true)}><Target size={17} /> تنظیم هدف</button></div>
          <div className="gauge" style={{ "--progress": Math.min(100, Math.max(0, ratio ?? 0)) + "%" } as React.CSSProperties}>
            <div><strong>{ratio == null ? "—" : decimal(Math.round(ratio * 10) / 10) + "٪"}</strong><span>تحقق هدف</span></div>
          </div>
          <p>{data.target && Number(data.target) > 0 ? money(data.target, currency) + " " + currency.currency : "برای این بازه هدفی تنظیم نشده است."}</p>
        </section>
        <section className="panel report-panel">
          <div className="section-head"><h3>تعداد فروش هر آیتم</h3></div>
          {data.products.length ? <div className="bars">{data.products.map((item) => <div className="bar-item" key={item.name}>
            <div><span>{localDigits(item.name)}</span><strong>{decimal(item.quantity)}</strong></div>
            <div className="bar-track"><i style={{ width: item.quantity / maxQuantity * 100 + "%" }} /></div>
          </div>)}</div> : <Blank title="فروشی در این بازه ثبت نشده است" />}
        </section>
      </div>
      {!!data.products.length && <div className="panel table-wrap">
        <table><thead><tr><th>آیتم فروخته‌شده</th><th>تعداد</th><th>جمع فروش پیش از تخفیف ({currency.currency})</th><th>متریال ({currency.currency})</th><th>سود پیش از تخفیف ({currency.currency})</th><th>فاقد متریال</th></tr></thead><tbody>
          {data.products.map((item) => <tr key={item.name}><td>{localDigits(item.name)}</td><td>{decimal(item.quantity)}</td><td>{money(item.sales, currency)}</td><td>{item.missing ? "ناقص" : money(item.material, currency)}</td><td>{item.missing ? "ناقص" : money(Number(item.sales) - Number(item.material), currency)}</td><td>{decimal(item.missing)}</td></tr>)}
        </tbody></table>
      </div>}
      <section className="panel report-panel">
        <div className="section-head"><div><h3>فروش دستی</h3><p>جمع فروش دستی در این بازه {money(data.manual_total)} تومان</p></div>
          <button className="button soft" onClick={() => setManual({ id: 0, date: "", amount: "", note: "" })}><Plus size={17} /> ثبت فروش دستی</button></div>
        {data.manual.length > 0 && <div className="table-wrap">
          <table><thead><tr><th>تاریخ</th><th>مبلغ ثبت‌شده</th><th>یادداشت</th><th>عملیات</th></tr></thead><tbody>
            {data.manual.map((row) => <tr key={row.id}><td>{persianDate(row.date)}</td><td>{money(row.amount)}</td><td>{row.note || "—"}</td>
              <td><div className="table-actions"><button className="button icon soft" aria-label="ویرایش فروش دستی" onClick={() => setManual(row)}><Pencil size={16} /></button><button className="button icon danger" aria-label="حذف فروش دستی" onClick={() => setRemove(row)}><Trash2 size={16} /></button></div></td></tr>)}
          </tbody></table>
        </div>}
      </section>
      {target && <Modal title="هدف فروش بازه" close={() => setTarget(false)}>
        <DataForm action={(form) => client("/reports/target", "POST", { start: data.start, end: data.end, amount: baseMoney(String(form.get("amount")), currency) })} saved={() => saved("هدف فروش ذخیره شد.")}>
          <p>{persianDate(data.start)} تا {persianDate(data.end)}</p>
          <label>هدف فروش ({currency.currency})<NumericInput name="amount" fractionDigits={4} grouped defaultValue={data.target == null ? "" : money(data.target, currency)} required /></label>
        </DataForm>
      </Modal>}
      {manual && <Modal title={manual.id ? "ویرایش فروش دستی" : "ثبت فروش دستی"} close={() => setManual(null)}>
        <ManualSaleForm client={client} entry={manual} saved={() => saved("فروش دستی ذخیره شد.")} />
      </Modal>}
      {remove && <Modal title="حذف فروش دستی" close={() => setRemove(null)}>
        <DataForm action={() => client("/reports/manual/" + remove.id, "DELETE")} saved={() => saved("فروش دستی حذف شد.")} button="تأیید حذف">
          <p>فروش دستی به مبلغ {money(remove.amount)} از گزارش حذف می‌شود.</p>
        </DataForm>
      </Modal>}
    </>}
  </section>;
}

type Entry = { id: number; year: number; month: number; day: number | null; person: string; kind: string; amount: number; note: string };
type Balance = { cash: number; mehdi: number; roham: number; receivable: number };
type MonthSummary = Balance & {
  month: number; name: string; opening: number; deposits: number; withdrawals: number; purchases: number; payroll: number;
  repayment: number; opening_receivable: number; difference: number; mehdi_withdrawal: number; roham_withdrawal: number;
  mehdi_available: string; roham_available: string; cumulative_purchases: number; cumulative_repayments: number;
};
type AccountsData = { year: number; month: number; selected: MonthSummary; months: MonthSummary[]; entries: Entry[]; withdrawals: Entry[]; people: Record<string, string>; kinds: Record<string, string>; opening: Balance | null };
const balanceFields = { cash: "مانده صندوق", mehdi: "خالص مهدی", roham: "خالص رهام", receivable: "طلب از کامیار" } as const;
const monthFields = { opening: "مانده اول صندوق", deposits: "واریزها", withdrawals: "برداشت‌ها", purchases: "خرید کافه", payroll: "پرداخت حقوق", repayment: "بازپرداخت کامیار", opening_receivable: "طلب ابتدای ماه", difference: "اختلاف خالص واریزی", mehdi: "خالص مهدی", roham: "خالص رهام", mehdi_withdrawal: "برداشت مهدی", roham_withdrawal: "برداشت رهام", cumulative_purchases: "خرید تا پایان ماه", cumulative_repayments: "بازپرداخت تا پایان ماه" } as const;

export function Accounts({ client, prefix, notify }: Common) {
  const [data, setData] = useState<AccountsData>();
  const [tab, setTab] = useState<"month" | "year" | "withdrawals">("month");
  const [edit, setEdit] = useState<Entry | null>(null);
  const [remove, setRemove] = useState<Entry | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (year?: string | number, month?: string | number) => {
    setBusy(true); setError("");
    try { setData(await client<AccountsData>(year && month ? "/accounts?year=" + encodeURIComponent(year) + "&month=" + encodeURIComponent(month) : "/accounts")); }
    catch (error) { setError(formatError(error)); }
    finally { setBusy(false); }
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);

  function saved(message: string) {
    setEdit(null); setRemove(null); setOpening(false);
    void refresh(data?.year, data?.month); notify(message);
  }

  return <section className="workspace-page">
    <div className="section-head"><div><h2>حسابداری صندوق</h2><p>تراکنش‌ها، حساب شرکا و سهم قابل برداشت به تومان</p></div>
      {data && <a className="button soft" href={prefix + "/export/" + (tab === "withdrawals" ? "withdrawals" : "accounts") + "?year=" + data.year}><ArrowDownToLine size={17} /> خروجی اکسل (CSV)</a>}</div>
    <Feedback error={error} />
    {!data ? error ? <button className="button soft" onClick={() => void refresh()}>تلاش دوباره</button> : <div className="skeleton" /> : <>
      <div className="panel filter-panel">
        <form key={data.year + "/" + data.month} className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void refresh(numeric(String(form.get("year"))), String(form.get("month")));
        }}>
          <label>سال شمسی<NumericInput name="year" defaultValue={decimal(data.year).replace(/٬/g, "")} required /></label>
          <label>ماه<select name="month" defaultValue={data.month}>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
          <button className="button primary" disabled={busy}><CalendarDays size={17} /> نمایش</button>
        </form>
        <button className="button soft" onClick={() => setOpening(true)}>مانده ابتدای سال</button>
      </div>
      <div className="toolbar">
        {([[ "month", "حساب ماهانه" ], [ "year", "خلاصه سالانه" ], [ "withdrawals", "گزارش برداشت‌ها" ]] as const).map(([key, label]) => <button className={"chip " + (tab === key ? "selected" : "")} type="button" key={key} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {tab === "month" && <>
        <div className="stat-grid">
          <Stat icon={<Wallet size={20} />} name="مانده پایان صندوق" value={money(data.selected.cash)} description="تومان" />
          <Stat icon={<Coins size={20} />} name="قابل برداشت مهدی" value={money(data.selected.mehdi_available)} description="تومان" />
          <Stat icon={<Coins size={20} />} name="قابل برداشت رهام" value={money(data.selected.roham_available)} description="تومان" />
          <Stat icon={<TrendingUp size={20} />} name="مانده طلب از کامیار" value={money(data.selected.receivable)} description="تومان" />
        </div>
        <div className="panel report-panel">
          <div className="section-head"><h3>جزئیات {data.selected.name}</h3></div>
          <dl className="ledger-detail">{Object.entries(monthFields).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{money(data.selected[key as keyof typeof monthFields])}</dd></div>)}</dl>
        </div>
        <div className="section-head"><h3>تراکنش‌های {data.selected.name}</h3><button className="button primary" onClick={() => setEdit({
          id: 0, year: data.year, month: data.month, day: null, person: "mehdi", kind: "deposit", amount: 0, note: "",
        })}><Plus size={18} /> ثبت تراکنش</button></div>
        <Entries entries={data.entries} data={data} edit={setEdit} remove={setRemove} />
      </>}
      {tab === "year" && <div className="panel table-wrap"><table><thead><tr>
        <th>ماه</th><th>اول صندوق</th><th>واریزها</th><th>برداشت‌ها</th><th>خریدها</th><th>حقوق</th><th>بازپرداخت</th><th>طلب کامیار</th><th>پایان صندوق</th><th>خالص مهدی</th><th>خالص رهام</th><th>قابل برداشت مهدی</th><th>قابل برداشت رهام</th>
      </tr></thead><tbody>{data.months.map((month) => <tr key={month.month}><td>{month.name}</td>{([ "opening", "deposits", "withdrawals", "purchases", "payroll", "repayment", "receivable", "cash", "mehdi", "roham", "mehdi_available", "roham_available" ] as const).map((key) => <td key={key}>{money(month[key])}</td>)}</tr>)}</tbody></table></div>}
      {tab === "withdrawals" && <Entries entries={data.withdrawals} data={data} edit={setEdit} remove={setRemove} />}
      {edit && <Modal title={edit.id ? "ویرایش تراکنش" : "ثبت تراکنش صندوق"} close={() => setEdit(null)}>
        <DataForm action={(form) => client("/accounts/transaction" + (edit.id ? "/" + edit.id : ""), edit.id ? "PATCH" : "POST", {
          year: numeric(String(form.get("year"))), month: form.get("month"), day: numeric(String(form.get("day"))),
          person: form.get("person"), kind: form.get("kind"), amount: numeric(String(form.get("amount"))), note: form.get("note"),
        })} saved={() => saved("تراکنش ذخیره شد.")}>
          <div className="form-row three"><label>سال شمسی<NumericInput name="year" defaultValue={localDigits(String(edit.year))} required /></label>
          <label>ماه<select name="month" defaultValue={edit.month}>{months.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}</select></label>
          <label>روز (اختیاری)<NumericInput name="day" defaultValue={edit.day ?? ""} /></label></div>
          <div className="form-row"><label>شخص<select name="person" defaultValue={edit.person}>{Object.entries(data.people).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label>نوع تراکنش<select name="kind" defaultValue={edit.kind}>{Object.entries(data.kinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>
          <label>مبلغ (تومان)<NumericInput name="amount" grouped defaultValue={edit.amount ? money(edit.amount) : ""} required /></label>
          <label>یادداشت<input name="note" defaultValue={edit.note} maxLength={250} /></label>
        </DataForm>
      </Modal>}
      {remove && <Modal title="حذف تراکنش" close={() => setRemove(null)}>
        <DataForm action={() => client("/accounts/transaction/" + remove.id, "DELETE")} saved={() => saved("تراکنش حذف شد.")} button="تأیید حذف"><p>{data.kinds[remove.kind]} به مبلغ {money(remove.amount)} تومان از حساب حذف می‌شود.</p></DataForm>
      </Modal>}
      {opening && <Modal title={"مانده ابتدای سال " + localDigits(String(data.year))} close={() => setOpening(false)}>
        <DataForm action={(form) => client("/accounts/opening", "POST", { year: data.year, ...Object.fromEntries(Object.keys(balanceFields).map((key) => [key, numeric(String(form.get(key)))])) })} saved={() => saved("مانده ابتدای سال ذخیره شد.")}>
          <p>در صورت ثبت مانده دستی، محاسبات این سال از مبالغ زیر آغاز می‌شوند.</p>
          {Object.entries(balanceFields).map(([key, label]) => <label key={key}>{label}<NumericInput name={key} signed grouped defaultValue={money(data.opening?.[key as keyof Balance] ?? (key === "cash" ? data.months[0].opening : key === "receivable" ? data.months[0].opening_receivable : 0))} required /></label>)}
        </DataForm>
      </Modal>}
    </>}
  </section>;
}

function Entries({ data, entries, edit, remove }: { data: AccountsData; entries: Entry[]; edit: (entry: Entry) => void; remove: (entry: Entry) => void }) {
  if (!entries.length) return <Blank title="تراکنشی برای نمایش وجود ندارد" />;
  return <div className="panel table-wrap"><table><thead><tr><th>تاریخ شمسی</th><th>شخص</th><th>نوع تراکنش</th><th>مبلغ (تومان)</th><th>یادداشت</th><th>عملیات</th></tr></thead>
    <tbody>{entries.map((entry) => <tr key={entry.id}>
      <td>{entry.day ? localDigits([entry.year, entry.month, entry.day].map((n) => String(n).padStart(2, "0")).join("/")) : months[entry.month - 1] + "، روز نامشخص"}</td>
      <td>{data.people[entry.person]}</td><td>{data.kinds[entry.kind]}</td><td>{money(entry.amount)}</td><td>{entry.note || "—"}</td>
      <td><div className="table-actions"><button className="button icon soft" aria-label="ویرایش تراکنش" onClick={() => edit(entry)}><Pencil size={16} /></button><button className="button icon danger" aria-label="حذف تراکنش" onClick={() => remove(entry)}><Trash2 size={16} /></button></div></td>
    </tr>)}</tbody></table></div>;
}
