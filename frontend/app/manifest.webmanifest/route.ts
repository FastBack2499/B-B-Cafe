import { manifest } from "../manifests";

export function GET() {
  return Response.json(manifest(), { headers: { "Content-Type": "application/manifest+json" } });
}
