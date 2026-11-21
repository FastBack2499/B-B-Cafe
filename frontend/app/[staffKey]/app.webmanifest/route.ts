import { manifest } from "../../manifests";
import { validStaffKey } from "../../staff-key";

export async function GET(_request: Request, context: { params: Promise<{ staffKey: string }> }) {
  const { staffKey } = await context.params;
  if (!validStaffKey(staffKey)) return new Response(null, { status: 404 });
  return Response.json(manifest(staffKey), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
