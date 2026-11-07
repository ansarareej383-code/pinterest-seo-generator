import { NextResponse } from "next/server";
import { generatePackage, ArticleReadError } from "../../../lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simple in-memory per-IP rate limit: 10 generations per hour per IP.
// NOTE (serverless limitation): this Map lives in one function instance's
// memory. On Vercel, instances are ephemeral and not shared, so this is a
// best-effort brake, not a hard global limit. For strict limits use a
// shared store (e.g. Upstash Redis) or Vercel Firewall — see README.md.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > MAX_PER_WINDOW;
}

export async function POST(request) {
  const ip =
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (rateLimited(ip)) {
    return NextResponse.json(
      {
        error:
          "Rate limit reached: this tool allows 10 generations per hour per visitor. Please wait a bit and try again.",
      },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const variation = Number.isInteger(body?.variation) ? Math.min(Math.max(body.variation, 0), 50) : 0;
  if (!url) {
    return NextResponse.json({ error: "Please paste an article URL first." }, { status: 400 });
  }

  try {
    const pkg = await generatePackage(url, variation);
    return NextResponse.json(pkg);
  } catch (err) {
    if (err instanceof ArticleReadError) {
      const status = err.code === "invalid" ? 400 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return NextResponse.json(
      { error: "Something went wrong while generating. Please try again." },
      { status: 500 }
    );
  }
}
