import { describe, expect, it } from 'vitest'
import { dictionaries, fill, pickLocale, translate } from './index'

describe('i18n', () => {
  it('fills params', () => {
    expect(translate('en', 'menu.saveTo', { file: 'robot.blend' })).toBe('Save to robot.blend')
  })

  it('picks plural forms from count', () => {
    expect(translate('en', 'toast.bones', { count: 1 })).toBe('1 bone')
    expect(translate('en', 'toast.bones', { count: 20 })).toBe('20 bones')
  })

  it('falls back to English for an unknown locale', () => {
    expect(translate('xx', 'common.cancel')).toBe('Cancel')
  })

  it('leaves unknown placeholders alone', () => {
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}')
  })

  it('matches a base language for a regional tag', () => {
    expect(pickLocale(['en-GB'])).toBe('en')
    expect(pickLocale(['zz-ZZ'])).toBe('en')
  })

  it('has no empty strings', () => {
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        expect(node.trim(), path).not.toBe('')
        return
      }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k)
      }
    }
    walk(dictionaries.en, '')
  })
})
