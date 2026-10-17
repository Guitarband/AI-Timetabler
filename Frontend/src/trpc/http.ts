// Browser requests must come from the app origin. Non-browser clients without
// Origin remain supported, but POSTs must still be JSON (no HTML form fallback).
export function rejectUnsafeRequest(req: Request): Response | null {
  const reject = (status: number) =>
    new Response(status === 403 ? "Forbidden" : "Expected application/json", {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  if (req.headers.get("sec-fetch-site") === "cross-site") return reject(403);
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const expected = new URL(process.env.BETTER_AUTH_URL ?? req.url).origin;
      if (new URL(origin).origin !== expected) return reject(403);
    } catch {
      return reject(403);
    }
  }
  if (
    req.method === "POST" &&
    req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json"
  ) {
    return reject(415);
  }
  return null;
}
