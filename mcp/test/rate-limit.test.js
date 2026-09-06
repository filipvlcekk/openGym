import { describe, expect, test } from 'vitest'

import { createFixedWindowLimiter } from '../src/rate-limit.js'

describe('fixed window rate limiter', () => {
  test('allows requests under the limit', () => {
    let now = 1000
    const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 10000, now: () => now })

    expect(limiter.check('tok_a')).toEqual({ ok: true, remaining: 2, resetAt: 11000 })
    expect(limiter.check('tok_a')).toEqual({ ok: true, remaining: 1, resetAt: 11000 })
    expect(limiter.check('tok_a')).toEqual({ ok: true, remaining: 0, resetAt: 11000 })

    now = 11000
    expect(limiter.check('tok_a')).toEqual({ ok: true, remaining: 2, resetAt: 21000 })
  })

  test('rejects requests over the limit with retryAfter', () => {
    let now = 1000
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 10000, now: () => now })

    expect(limiter.check('tok_a').ok).toBe(true)
    expect(limiter.check('tok_a').ok).toBe(true)
    now = 2500
    expect(limiter.check('tok_a')).toEqual({
      ok: false,
      remaining: 0,
      resetAt: 11000,
      retryAfter: 9
    })
  })

  test('separates buckets by key', () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 10000, now: () => 1000 })

    expect(limiter.check('tok_a')).toEqual({ ok: true, remaining: 0, resetAt: 11000 })
    expect(limiter.check('tok_b')).toEqual({ ok: true, remaining: 0, resetAt: 11000 })
    expect(limiter.check('tok_a')).toEqual({
      ok: false,
      remaining: 0,
      resetAt: 11000,
      retryAfter: 10
    })
  })

  test('can reset all buckets', () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 10000, now: () => 1000 })

    expect(limiter.check('tok_a').ok).toBe(true)
    expect(limiter.check('tok_a').ok).toBe(false)
    limiter.reset()
    expect(limiter.check('tok_a')).toEqual({ ok: true, remaining: 0, resetAt: 11000 })
  })
})
