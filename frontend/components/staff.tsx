"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  BarChart3, BookOpen, Check, ClipboardList, Coffee, History, KeyRound, LayoutGrid, LockKeyhole,
  LogOut, Menu as MenuIcon, Pencil,
} from "lucide-react";
import { Brand, Feedback, Modal, RequestError, formatError, request } from "./shared";
import type { Client, Currency, Menu, User } from "./shared";
import { InstallButton } from "./pwa";
import { PointOfSale } from "./pos";
import { Orders } from "./orders";
import { ManageMenu } from "./manage-menu";
import { ManualSale } from "./manual-sale";
import { Accounts, Sales } from "./reports";

const pages = [
  { key: "pos", label: "ثبت سفارش", icon: LayoutGrid },
  { key: "manual", label: "ثبت دستی", icon: Pencil },
  { key: "open", label: "سفارش‌های باز", icon: ClipboardList },
  { key: "history", label: "تاریخچه سفارش‌ها", icon: History },
  { key: "menu", label: "مدیریت منو", icon: Coffee, owner: true },
  { key: "sales", label: "حساب ماه", icon: BarChart3, owner: true },
  { key: "accounts", label: "حسابداری صندوق", icon: BookOpen, owner: true },
] as const;
type Page = typeof pages[number]["key"];
type Auth = { user: User | null; csrf: string };
const fallbackCurrency: Currency = { currency: "تومان", multiplier: 1000 };

export function Staff({ staffKey }: { staffKey: string }) {
  const [user, setUser] = useState<User | null>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState<Page>("pos");
  const [drawer, setDrawer] = useState(false);
  const [password, setPassword] = useState(false);
  const [menu, setMenu] = useState<Menu>();
  const csrf = useRef("");
  const prefix = "/api/staff/" + staffKey;
  const client = useCallback<Client>(async (path, method, body) => {
    try { return await request(prefix + path, method, body, csrf.current); }
    catch (error) {
      if (error instanceof RequestError && error.status === 401 && path !== "/session") {
        setUser(null);
        setMenu(undefined);
      }
      throw error;
    }
  }, [prefix]);
  const loadSession = useCallback(async () => {
    setError("");
    try {
      const data = await client<Auth>("/session");
      csrf.current = data.csrf;
      setUser(data.user);
    } catch (error) {
      setError(formatError(error));
    }
  }, [client]);
  const refreshMenu = useCallback(async () => {
    setMenu(await client<Menu>("/menu"));
  }, [client]);
  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => {
    if (user) void refreshMenu().catch((error: unknown) => setError(formatError(error)));
  }, [user, refreshMenu]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3800);
    return () => clearTimeout(timer);
  }, [notice]);

  async function logIn(username: string, password: string) {
    const data = await client<Auth>("/session", "POST", { username, password });
    csrf.current = data.csrf;
    setPage("pos");
    setError("");
    setUser(data.user);
  }
  async function logOut() {
    try {
      const data = await client<Auth>("/session", "DELETE");
      csrf.current = data.csrf;
      setNotice("");
      setUser(null);
      setMenu(undefined);
    } catch (error) { setError(formatError(error)); }
  }

  if (user === undefined) return <main className="standalone-message"><Brand caption="پنل کافه" /><Feedback error={error} />
    {error ? <button className="button soft" onClick={() => void loadSession()}>تلاش دوباره</button> : <p role="status">در حال بارگذاری…</p>}</main>;
  if (!user) return <SignIn onSubmit={logIn} />;

  const activePage = pages.find((item) => item.key === page) || pages[0];
  const currency = menu?.settings || fallbackCurrency;
  function navigate(next: Page) {
    setPage(next);
    setDrawer(false);
    setError("");
  }

  return <div className="staff-layout">
    {drawer && <button className="drawer-overlay" aria-label="بستن فهرست" onClick={() => setDrawer(false)} />}
    <aside className={"staff-sidebar " + (drawer ? "open" : "")}>
      <Brand caption="پنل کافه" />
      <nav aria-label="صفحات پنل">
        {pages.filter((item) => !("owner" in item) || user.role === "owner").map(({ key, label, icon: Icon }) =>
          <button type="button" key={key} className={page === key ? "current" : ""} aria-current={page === key ? "page" : undefined} onClick={() => navigate(key)}><Icon size={19} />{label}</button>
        )}
      </nav>
      <div className="staff-bottom">
        <a href="/"><MenuIcon size={18} /> منوی عمومی</a>
        {user.role === "owner" && <button type="button" onClick={() => { setPassword(true); setDrawer(false); }}><KeyRound size={18} /> تغییر رمز عبور</button>}
        <button type="button" onClick={() => void logOut()}><LogOut size={18} /> خروج</button>
      </div>
    </aside>
    <div className="staff-main">
      <header className="staff-header">
        <div className="header-title">
          <button className="button icon only-mobile" aria-label="باز کردن فهرست" onClick={() => setDrawer(true)}><MenuIcon size={22} /></button>
          <h1>{activePage.label}</h1>
        </div>
        <div className="staff-profile"><InstallButton /><span className="avatar">{Array.from(user.name)[0]}</span><div><strong>{user.name}</strong><small>{user.role === "owner" ? "مدیر کافه" : "باریستا"}</small></div></div>
      </header>
      <main className="workspace">
        <Feedback error={error} />
        <div hidden={page !== "pos"} className="workspace-page">
          {menu ? <PointOfSale client={client} menu={menu} refreshMenu={refreshMenu} notify={setNotice} showOrders={() => navigate("open")} /> :
            <div className="skeleton" aria-label="در حال بارگذاری منو" />}
        </div>
        {page === "manual" && <ManualSale client={client} notify={setNotice} />}
        {(page === "open" || page === "history") && <Orders key={page} history={page === "history"} owner={user.role === "owner"} client={client} currency={currency} notify={setNotice} />}
        {user.role === "owner" && page === "menu" && <ManageMenu client={client} refreshMenu={refreshMenu} notify={setNotice} />}
        {user.role === "owner" && page === "sales" && <Sales client={client} prefix={prefix} currency={currency} notify={setNotice} />}
        {user.role === "owner" && page === "accounts" && <Accounts client={client} prefix={prefix} notify={setNotice} />}
      </main>
    </div>
    {notice && <div className="toast" role="status"><Check size={19} /> {notice}</div>}
    {user.role === "owner" && password && <PasswordDialog client={client} close={() => setPassword(false)} saved={(token) => {
      csrf.current = token;
      setPassword(false);
      setNotice("رمز عبور تغییر کرد.");
    }} />}
  </div>;
}

function SignIn({ onSubmit }: { onSubmit: (user: string, password: string) => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try { await onSubmit(String(data.get("username")), String(data.get("password"))); }
    catch (error) { setError(formatError(error)); }
    finally { setBusy(false); }
  }
  return <main className="login-layout">
    <div className="login-picture"><div><span className="hero-tag"><Coffee size={16} /> کافه</span><p>نان و کره</p></div></div>
    <div className="login-side">
      <section className="login-form">
        <Brand caption="پنل کافه" />
        <h1>ورود به پنل</h1>
        <p>با حساب کاری خود وارد شوید.</p>
        <form onSubmit={submit} className="form-grid">
          <label>نام کاربری<input name="username" required autoComplete="username" maxLength={150} dir="ltr" /></label>
          <label>رمز عبور<input name="password" type="password" required autoComplete="current-password" maxLength={512} dir="ltr" /></label>
          <Feedback error={error} />
          <button type="submit" disabled={busy} className="button primary"><LockKeyhole size={17} />{busy ? "در حال ورود…" : "ورود"}</button>
        </form>
        <InstallButton />
      </section>
    </div>
  </main>;
}

function PasswordDialog({ close, client, saved }: { close: () => void; client: Client; saved: (token: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("password") !== data.get("confirm")) return setError("تکرار رمز عبور با رمز جدید یکسان نیست.");
    setBusy(true);
    setError("");
    try { saved((await client<{ csrf: string }>("/password", "POST", { current: data.get("current"), password: data.get("password") })).csrf); }
    catch (error) { setError(formatError(error)); }
    finally { setBusy(false); }
  }
  return <Modal title="تغییر رمز عبور" close={close}><form className="form-grid" onSubmit={submit}>
    <label>رمز فعلی<input name="current" required type="password" autoComplete="current-password" dir="ltr" /></label>
    <label>رمز جدید<input name="password" required type="password" minLength={12} maxLength={512} autoComplete="new-password" dir="ltr" /></label>
    <label>تکرار رمز جدید<input name="confirm" required type="password" minLength={12} maxLength={512} autoComplete="new-password" dir="ltr" /></label>
    <Feedback error={error} /><button className="button primary" disabled={busy}>ذخیره رمز</button>
  </form></Modal>;
}
