"use client";

import { useEffect, useId, useRef } from "react";
import { Coffee, CupSoda, Croissant, Flame, GlassWater, IceCreamCone, Leaf, Martini, Sandwich, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Currency = { currency: string; multiplier: number };
export type Category = { slug: string; name: string; position: number };
export type Product = {
  id: number; code: number; category: string; category_name: string; name: string; description: string;
  price: string | null; active: boolean; cost?: string | null; effective_cost?: string | null;
  profit?: string | null; margin?: string | null; recipe?: Recipe[];
};
export type Recipe = { ingredient: number; quantity: string };
export type Menu = { products: Product[]; categories: Category[]; settings: Currency };
export type User = { id: number; name: string; role: "owner" | "barista" };
export type OrderLine = { id: number; name: string; quantity: number; price: string; line_total: string; cost?: string | null };
export type Order = {
  id: number; legacy_number: string; status: "open" | "paid" | "cancelled"; created: string; closed: string | null;
  creator: string; note: string; subtotal: string; discount: string; total: string; payment: string; items: OrderLine[];
};
export type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

const digits = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
export const numberFormat = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 4 });
export const decimal = (v: number | string) => numberFormat.format(Number(v));
export const localDigits = (value: string) => value.replace(/[0-9]/g, (digit) => digits[Number(digit)]);
export const numeric = (value: string) => value.replace(/[۰-۹٠-٩]/g, (digit) => String(digits.includes(digit) ? digits.indexOf(digit) : arabicDigits.indexOf(digit))).replace(/[,٬]/g, "").replace(/٫/g, ".").replace(/−/g, "-");
export const normalized = (value: string) => numeric(value).toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ").trim();

export function money(value: string | number | null | undefined, currency?: Currency) {
  if (value == null) return "—";
  const multiplier = currency?.multiplier ?? 1;
  const match = typeof value === "string" ? /^(-?)(\d+)(?:\.(\d+))?$/.exec(value) : null;
  if (!match) return decimal(Number(value) * multiplier).replaceAll("٬", ",");

  const [, sign, whole, fraction = ""] = match;
  const scale = 10n ** BigInt(fraction.length);
  const amount = BigInt(whole + fraction) * BigInt(multiplier);
  const grouped = (amount / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = (amount % scale).toString().padStart(fraction.length, "0").replace(/0+$/, "");
  return localDigits((sign && amount ? "−" : "") + grouped + (decimals ? "٫" + decimals : ""));
}

export function baseMoney(value: string, currency: Currency) {
  const amount = numeric(value).trim();
  if (!amount) return "";
  const match = /^(\d*)(?:\.(\d*))?$/.exec(amount);
  if (!match || !(match[1] || match[2])) throw new Error("مبلغ واردشده معتبر نیست.");

  const [, whole, fraction = ""] = match;
  const scale = 10n ** BigInt(fraction.length) * BigInt(currency.multiplier);
  const scaledAmount = BigInt(whole + fraction) * 10000n;
  if (scaledAmount % scale !== 0n) throw new Error("دقت مبلغ واردشده بیشتر از حد مجاز است.");

  const base = scaledAmount / scale;
  return (base / 10000n) + "." + (base % 10000n).toString().padStart(4, "0");
}

type NumericInputProps = Omit<React.ComponentPropsWithoutRef<"input">, "type" | "inputMode" | "onChange" | "onBlur"> & {
  fractionDigits?: number;
  grouped?: boolean;
  signed?: boolean;
  onValueChange?: (value: string) => void;
};

export function NumericInput({ fractionDigits = 0, grouped = false, signed = false, onValueChange, ...props }: NumericInputProps) {
  function filter(value: string) {
    const sign = signed && /^[-−]/.test(value) ? "-" : "";
    const [whole, ...fraction] = fractionDigits ? value.split(/[.٫]/) : [value];
    const integer = whole.replace(grouped ? /[^0-9۰-۹٠-٩,٬]/g : /[^0-9۰-۹٠-٩]/g, "");
    const decimals = fraction.join("").replace(/[^0-9۰-۹٠-٩]/g, "").slice(0, fractionDigits);
    return sign + integer + (fraction.length ? "." + decimals : "");
  }

  return <input {...props} type="text" dir="ltr" className="numeric-input"
    inputMode={signed ? "text" : fractionDigits ? "decimal" : "numeric"}
    onChange={(event) => {
      const input = event.currentTarget;
      const value = filter(input.value);
      if (value !== input.value) {
        const caret = filter(input.value.slice(0, input.selectionStart ?? input.value.length)).length;
        input.value = value;
        input.setSelectionRange(caret, caret);
      }
      onValueChange?.(value);
    }}
    onBlur={(event) => {
      const input = event.currentTarget;
      const value = numeric(input.value);
      if (!/[0-9]/.test(value)) input.value = "";
      else if (grouped) input.value = money(value);
      onValueChange?.(input.value);
    }}
  />;
}

export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const shamsi = (value: string, time = false) =>
  new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", dateStyle: "medium", ...(time ? { timeStyle: "short" } : {}) }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value));

const persianDateFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" });
const datePattern = "[۰-۹٠-٩0-9]{4}/[۰-۹٠-٩0-9]{1,2}/[۰-۹٠-٩0-9]{1,2}";

export function persianDate(date?: string) {
  return persianDateFormatter.format(date ? new Date(date + "T12:00:00Z") : new Date()).replace(/[‎‏]/g, "");
}

export function DateInput({ name, label, value }: { name: string; label: string; value: string }) {
  return <label>{label}<input name={name} defaultValue={value} dir="ltr" inputMode="text" pattern={datePattern} placeholder="۱۴۰۵/۰۸/۰۱" required onChange={(event) => {
    const input = event.currentTarget;
    input.value = input.value.replace(/[^0-9۰-۹٠-٩/]/g, "");
  }} /></label>;
}

const icons: Record<string, LucideIcon> = {
  espresso: Coffee, iced: CupSoda, matcha: Leaf, hot: Flame, mocktail: Martini,
  shake: IceCreamCone, tea: GlassWater, bakery: Croissant, breakfast: Sandwich,
};
const categoryColors: Record<string, string> = {
  espresso: "sage", iced: "mist", matcha: "sage", hot: "peach", mocktail: "peach",
  shake: "pink", tea: "sage", bakery: "sand", breakfast: "sand",
};

export function CategoryIcon({ category, size = 21, tile = false }: { category: string; size?: number; tile?: boolean }) {
  const Icon = icons[category] || Coffee;
  return tile ? <span className={"icon-tile " + (categoryColors[category] || "sage")}><Icon size={size} strokeWidth={1.65} /></span> :
    <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function Brand({ caption = "کافه" }: { caption?: string }) {
  return <div className="brand"><span className="brand-icon"><Coffee size={23} strokeWidth={1.7} /></span><span><strong>نان و کره</strong><small>{caption}</small></span></div>;
}

export function SearchBox({ value, onChange, placeholder = "جستجوی آیتم منو…" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="search-box"><Search size={19} /><input type="search" value={value} aria-label={placeholder} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />{value && <button type="button" aria-label="پاک کردن جستجو" onClick={() => onChange("")}><X size={16} /></button>}</label>;
}

export function CategoryTabs({ options, active, onChange }: { options: Category[]; active: string; onChange: (v: string) => void }) {
  return <div className="categories" aria-label="دسته‌بندی منو">
    {[{ slug: "all", name: "همه آیتم‌ها", position: 0 }, ...options].map((category) =>
      <button key={category.slug} type="button" aria-pressed={category.slug === active} className={"chip " + (category.slug === active ? "selected" : "")} onClick={() => onChange(category.slug)}>
        {category.slug !== "all" && <CategoryIcon category={category.slug} size={17} />}{category.name}
      </button>)}
  </div>;
}

export function Blank({ title, detail }: { title: string; detail?: string }) {
  return <div className="blank"><span className="icon-tile sage"><Coffee size={24} strokeWidth={1.5} /></span><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}

export function Feedback({ error }: { error: string }) {
  return error ? <p role="alert" className="error">{error}</p> : null;
}

export function formatError(error: unknown) {
  return error instanceof Error ? error.message : "درخواست انجام نشد.";
}

export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function request<T>(url: string, method = "GET", body?: unknown, csrf?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method, credentials: "same-origin", cache: url === "/api/menu" ? "default" : "no-store",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(csrf === undefined || method === "GET" ? {} : { "X-CSRFToken": csrf }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new RequestError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.", 0);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new RequestError(payload?.error || "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.", response.status);
  return payload as T;
}

export function Modal({ title, close, children, className }: { title: string; close: () => void; children: React.ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={className} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="button icon" aria-label="بستن" onClick={close}><X size={20} /></button></div>
    {children}
  </dialog>;
}
