import { HttpError } from "@/lib/http";

// Process-local fallback for development only. Production must add a shared limiter at the edge.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function enforceRateLimit(key: string, max = 30, windowMs = 60_000) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= max) throw new HttpError(429, "RATE_LIMITED", "Too many requests. Try again shortly.");
  current.count += 1;
}
