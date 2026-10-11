import { createSignal, type JSX } from 'solid-js'
import {
  dictionaries,
  pickLocale,
  translate,
  type MessageKey,
  type Params
} from '../../shared/i18n'

export type { MessageKey } from '../../shared/i18n'

const LOCALE_KEY = 'meshanimate:locale'

function initialLocale(): string {
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (saved && dictionaries[saved]) {
      return saved
    }
  } catch {
    // Preference only.
  }
  return pickLocale(typeof navigator === 'undefined' ? [] : navigator.languages)
}

const [locale, setLocaleSignal] = createSignal(initialLocale())

function markDocument(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale()
  }
}
markDocument()

export { locale }

export function setLocale(next: string): void {
  setLocaleSignal(dictionaries[next] ? next : 'en')
  markDocument()
  try {
    localStorage.setItem(LOCALE_KEY, locale())
  } catch {
    // Preference only.
  }
}

/** Translated text. Reactive: re-runs when the language changes. */
export function t(key: MessageKey, params?: Params): string {
  return translate(locale(), key, params)
}

/**
 * Translated text with elements inside it, e.g. a <Kbd> or <b>. String and
 * number params are filled as text; element params replace their `{name}`.
 */
export function tr(
  key: MessageKey,
  params: Record<string, JSX.Element | string | number>
): JSX.Element {
  const text: Params = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number') {
      text[name] = value
    }
  }
  return translate(locale(), key, text)
    .split(/(\{\w+\})/)
    .filter((part) => part !== '')
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1]
      return name !== undefined && name in params ? params[name] : part
    })
}
