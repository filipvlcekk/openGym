export function createFixedWindowLimiter({ limit, windowMs, now = () => Date.now() }) {
  const buckets = new Map()

  return {
    check(key) {
      const current = now()
      const bucket = buckets.get(key)
      if (!bucket || current >= bucket.resetAt) {
        const resetAt = current + windowMs
        buckets.set(key, { count: 1, resetAt })
        return { ok: true, remaining: limit - 1, resetAt }
      }
      if (bucket.count >= limit) {
        return {
          ok: false,
          remaining: 0,
          resetAt: bucket.resetAt,
          retryAfter: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))
        }
      }
      bucket.count += 1
      return { ok: true, remaining: limit - bucket.count, resetAt: bucket.resetAt }
    },
    reset() {
      buckets.clear()
    }
  }
}
