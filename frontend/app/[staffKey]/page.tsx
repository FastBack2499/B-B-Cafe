import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Staff } from "@/components/staff";
import { validStaffKey } from "../staff-key";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ staffKey: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { staffKey } = await params;
  if (!validStaffKey(staffKey)) notFound();
  return {
    title: "پنل کافه",
    manifest: "/" + staffKey + "/app.webmanifest",
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function StaffPage({ params }: Props) {
  const { staffKey } = await params;
  if (!validStaffKey(staffKey)) notFound();
  return <Staff staffKey={staffKey} />;
}
