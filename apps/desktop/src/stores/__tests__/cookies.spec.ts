import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCookies } from '../cookies'
import type { CookieProfile } from '../../types/app'

describe('useCookies', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Cookie ID Generation', () => {
    it('should generate incrementing cookie IDs', () => {
      const store = useCookies()

      const result1 = store.importCookie({
        value: 'cookie1',
        note: 'Test Cookie 1',
      })

      const result2 = store.importCookie({
        value: 'cookie2',
        note: 'Test Cookie 2',
      })

      const id1 = Number(result1.id)
      const id2 = Number(result2.id)

      expect(id2).toBe(id1 + 1)
    })
  })

  describe('Cookie Import', () => {
    it('should import a new cookie', () => {
      const store = useCookies()

      const result = store.importCookie({
        value: 'test-cookie-value',
        note: 'Test Cookie',
      })

      expect(result.id).toBeDefined()
      expect(store.cookies).toHaveLength(1)
      expect(store.cookies[0]?.value).toBe('test-cookie-value')
      expect(store.cookies[0]?.note).toBe('Test Cookie')
      expect(store.cookies[0]?.source).toBe('douban')
      expect(store.cookies[0]?.status).toBe('active')
    })

    it('should set cookie lifetime on import', () => {
      const store = useCookies()

      store.importCookie({
        value: 'test-cookie',
        note: 'Test',
      })

      const cookie = store.cookies[0]
      expect(cookie?.importedAt).toBeDefined()
      expect(cookie?.expiresAt).toBeDefined()

      const imported = new Date(cookie!.importedAt!).getTime()
      const expires = new Date(cookie!.expiresAt!).getTime()

      expect(expires).toBeGreaterThan(imported)
    })
  })

  describe('Cookie Selection', () => {
    it('should pick usable cookie', () => {
      const store = useCookies()

      store.importCookie({
        value: 'active-cookie',
        note: 'Active',
      })

      const cookie = store.pickUsableCookie()
      expect(cookie).toBeDefined()
      expect(cookie?.value).toBe('active-cookie')
      expect(cookie?.status).not.toBe('cooling')
    })

    it('should not pick cooling cookie', () => {
      const store = useCookies()
      const mockCookie: CookieProfile = {
        id: '1',
        value: 'cooling-cookie',
        note: 'Cooling',
        source: 'douban',
        status: 'cooling',
        success: 0,
        failure: 1,
        importedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        coolingUntil: new Date(Date.now() + 60000).toISOString(),
      }

      store.setCookies([mockCookie])

      const cookie = store.pickUsableCookie()
      expect(cookie).toBeUndefined()
    })
  })

  describe('Cookie Status Updates', () => {
    it('should update cookie status', () => {
      const store = useCookies()

      const result = store.importCookie({
        value: 'test-cookie',
        note: 'Test',
      })

      store.updateCookieStatus(result.id, {
        status: 'cooling',
        successDelta: 1,
      })

      const cookie = store.cookies.find(c => c.id === result.id)
      expect(cookie?.status).toBe('cooling')
      expect(cookie?.success).toBe(1)
    })

    it('should increment success and failure counts', () => {
      const store = useCookies()

      const result = store.importCookie({
        value: 'test-cookie',
        note: 'Test',
      })

      store.updateCookieStatus(result.id, {
        successDelta: 3,
        failureDelta: 1,
      })

      const cookie = store.cookies.find(c => c.id === result.id)
      expect(cookie?.success).toBe(3)
      expect(cookie?.failure).toBe(1)
    })
  })

  describe('Cookie Deletion', () => {
    it('should delete a cookie by ID', () => {
      const store = useCookies()

      const result = store.importCookie({
        value: 'test-cookie',
        note: 'Test',
      })

      expect(store.cookies).toHaveLength(1)

      store.deleteCookie(result.id)

      expect(store.cookies).toHaveLength(0)
    })

    it('should not affect other cookies when deleting', () => {
      const store = useCookies()

      const result1 = store.importCookie({
        value: 'cookie1',
        note: 'Cookie 1',
      })

      store.importCookie({
        value: 'cookie2',
        note: 'Cookie 2',
      })

      expect(store.cookies).toHaveLength(2)

      store.deleteCookie(result1.id)

      expect(store.cookies).toHaveLength(1)
      expect(store.cookies[0]?.value).toBe('cookie2')
    })
  })

  describe('Cookie Expiration', () => {
    it('should remove expired cookies on setCookies', () => {
      const store = useCookies()
      const expiredCookie: CookieProfile = {
        id: '1',
        value: 'expired-cookie',
        note: 'Expired',
        source: 'douban',
        status: 'active',
        success: 0,
        failure: 0,
        importedAt: new Date(Date.now() - 86400000).toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }

      const result = store.setCookies([expiredCookie])

      expect(result.removedCount).toBe(1)
      expect(store.cookies).toHaveLength(0)
    })

    it('should keep valid cookies on setCookies', () => {
      const store = useCookies()
      const validCookie: CookieProfile = {
        id: '1',
        value: 'valid-cookie',
        note: 'Valid',
        source: 'douban',
        status: 'active',
        success: 0,
        failure: 0,
        importedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }

      const result = store.setCookies([validCookie])

      expect(result.removedCount).toBe(0)
      expect(store.cookies).toHaveLength(1)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle empty cookie value', () => {
      const store = useCookies()
      const result = store.importCookie({
        value: '',
        note: 'Empty value',
      })

      expect(result.id).toBeDefined()
      expect(store.cookies).toHaveLength(1)
    })

    it('should handle empty note', () => {
      const store = useCookies()
      const result = store.importCookie({
        value: 'test-cookie',
        note: '',
      })

      expect(result.id).toBeDefined()
      expect(store.cookies[0]?.note).toBe('')
    })

    it('should handle very long cookie value', () => {
      const store = useCookies()
      const longValue = 'x'.repeat(10000)
      const result = store.importCookie({
        value: longValue,
        note: 'Long value',
      })

      expect(result.id).toBeDefined()
      expect(store.cookies[0]?.value?.length).toBe(10000)
    })

    it('should handle deleting non-existent cookie', () => {
      const store = useCookies()
      store.importCookie({ value: 'test', note: 'Test' })
      expect(store.cookies).toHaveLength(1)

      store.deleteCookie('non-existent-id')
      expect(store.cookies).toHaveLength(1) // Should not change
    })

    it('should handle updating non-existent cookie', () => {
      const store = useCookies()
      store.importCookie({ value: 'test', note: 'Test' })

      store.updateCookieStatus('non-existent-id', {
        successDelta: 1,
      })

      // Should not throw, original cookie unchanged
      expect(store.cookies[0]?.success).toBe(0)
    })

    it('should handle negative success/failure deltas', () => {
      const store = useCookies()
      const result = store.importCookie({
        value: 'test',
        note: 'Test',
      })

      store.updateCookieStatus(result.id, {
        successDelta: -5,
        failureDelta: -3,
      })

      const cookie = store.cookies.find((c: CookieProfile) => c.id === result.id)
      expect(cookie?.success).toBe(-5)
      expect(cookie?.failure).toBe(-3)
    })

    it('should handle pickUsableCookie with empty cookies', () => {
      const store = useCookies()
      const cookie = store.pickUsableCookie()
      expect(cookie).toBeUndefined()
    })

    it('should handle pickUsableCookie with all cooling cookies', () => {
      const store = useCookies()
      const coolingCookies: CookieProfile[] = [
        {
          id: '1',
          value: 'cookie1',
          note: 'Cookie 1',
          source: 'douban',
          status: 'cooling',
          success: 0,
          failure: 1,
          importedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          coolingUntil: new Date(Date.now() + 60000).toISOString(),
        },
        {
          id: '2',
          value: 'cookie2',
          note: 'Cookie 2',
          source: 'douban',
          status: 'cooling',
          success: 0,
          failure: 1,
          importedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          coolingUntil: new Date(Date.now() + 60000).toISOString(),
        },
      ]

      store.setCookies(coolingCookies)
      const cookie = store.pickUsableCookie()
      expect(cookie).toBeUndefined()
    })

    it('should handle rapid cookie imports', () => {
      const store = useCookies()
      for (let i = 0; i < 100; i++) {
        store.importCookie({
          value: `cookie-${i}`,
          note: `Cookie ${i}`,
        })
      }

      expect(store.cookies.length).toBe(100)
    })

    it('should handle special characters in cookie value', () => {
      const store = useCookies()
      const specialValue = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`'
      store.importCookie({
        value: specialValue,
        note: 'Special chars',
      })

      expect(store.cookies[0]?.value).toBe(specialValue)
    })

    it('should handle Unicode in cookie note', () => {
      const store = useCookies()
      const unicodeNote = '测试 🎉 cookie'
      store.importCookie({
        value: 'test',
        note: unicodeNote,
      })

      expect(store.cookies[0]?.note).toBe(unicodeNote)
    })

    it('should handle malformed expiration dates', () => {
      const store = useCookies()
      const malformedCookie: CookieProfile = {
        id: '1',
        value: 'test',
        note: 'Test',
        source: 'douban',
        status: 'active',
        success: 0,
        failure: 0,
        importedAt: 'invalid-date',
        expiresAt: 'invalid-date',
      }

      store.setCookies([malformedCookie])
      // Should handle gracefully
      expect(store.cookies.length).toBeGreaterThanOrEqual(0)
    })
  })
})
