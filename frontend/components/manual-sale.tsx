"use client";

import { useRef, useState } from "react";
import { DataForm } from "./manage-menu";
import { DateInput, NumericInput, money, numeric, persianDate } from "./shared";
import type { Client } from "./shared";

export type ManualSaleRecord = { id: number; date: string; amount: string; note: string };

export function ManualSaleForm({ client, saved, entry }: { client: Client; saved: () => void; entry?: ManualSaleRecord }) {
  const attempt = useRef<{ values: string; id: string } | null>(null);

  return <DataForm action={(form) => {
    const data = {
      day: numeric(String(form.get("day"))),
      amount: numeric(String(form.get("amount"))),
      note: form.get("note"),
    };
    if (entry?.id) return client("/reports/manual/" + entry.id, "PATCH", data);
    const values = JSON.stringify(data);
    if (attempt.current?.values !== values) attempt.current = { values, id: crypto.randomUUID() };
    return client("/orders/manual", "POST", { ...data, request_id: attempt.current.id });
  }} saved={saved} button={entry?.id ? "ذخیره" : "ثبت فروش دستی"}>
    <div className="form-row">
      <DateInput name="day" label="تاریخ شمسی" value={persianDate(entry?.date || undefined)} />
      <label>مبلغ (تومان)<NumericInput name="amount" defaultValue={entry?.amount ? money(entry.amount) : ""} fractionDigits={4} grouped required /></label>
    </div>
    <label>یادداشت (اختیاری)<input name="note" defaultValue={entry?.note} maxLength={200} /></label>
  </DataForm>;
}

export function ManualSale({ client, notify }: { client: Client; notify: (message: string) => void }) {
  const [formKey, setFormKey] = useState(0);
  return <section className="workspace-page">
    <div className="section-head"><h2>ثبت فروش دستی</h2></div>
    <div className="panel form-panel">
      <ManualSaleForm key={formKey} client={client} saved={() => {
        setFormKey((current) => current + 1);
        notify("فروش دستی ذخیره شد.");
      }} />
    </div>
  </section>;
}
