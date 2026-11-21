import { timingSafeEqual } from "node:crypto";

export function validStaffKey(key: string) {
  const supplied = Buffer.from(key);
  const configured = Buffer.from(process.env.STAFF_ROUTE_KEY || "");
  return supplied.length > 0 && supplied.length === configured.length && timingSafeEqual(supplied, configured);
}
