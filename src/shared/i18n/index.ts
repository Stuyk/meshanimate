/**
 * Translations for every piece of text the app shows. Both the main process
 * and the renderer use this module.
 *
 * Each language is a dictionary with the same shape as `en`. A value is
 * either a string or a set of plural forms ({ one, other, ... }, chosen with
 * Intl.PluralRules from the `count` param). `{name}` in a string is filled
 * from the params. Missing keys fall back to English.
 *
 * To add a language: copy en.ts to e.g. de.ts, translate the values, and
 * register it in `dictionaries` below.
 */
import { en } from './en'

export interface PluralForms {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

type Entry = string | PluralForms

/** A dictionary shaped like the English one, with any strings as values. */
export type Dictionary<T = typeof en> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends PluralForms
      ? PluralForms
      : Dictionary<T[K]>
}

/** Every key in the dictionary, as a dotted path: 'timeline.play'. */
export type MessageKey<T = typeof en, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | PluralForms
    ? `${P}${K}`
    : MessageKey<T[K], `${P}${K}.`>
}[keyof T & string]

export type Params = Record<string, string | number>

export const DEFAULT_LOCALE = 'en'

export const dictionaries: Record<string, Dictionary> = { en }

/** The best supported locale for a list of preferred ones ('de-AT' matches 'de'). */
export function pickLocale(preferred: readonly string[]): string {
  for (const tag of preferred) {
    if (dictionaries[tag]) {
      return tag
    }
    const base = tag.split('-')[0]
    if (dictionaries[base]) {
      return base
    }
  }
  return DEFAULT_LOCALE
}

function lookup(dict: Dictionary | undefined, key: string): Entry | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) {
      return undefined
    }
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node === 'string') {
    return node
  }
  if (typeof node === 'object' && node !== null && 'other' in node) {
    return node as PluralForms
  }
  return undefined
}

/** Fills `{name}` placeholders. Unknown placeholders are left as they are. */
export function fill(template: string, params?: Params): string {
  if (!params) {
    return template
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole
  )
}

export function translate(locale: string, key: MessageKey, params?: Params): string {
  const entry = lookup(dictionaries[locale], key) ?? lookup(dictionaries[DEFAULT_LOCALE], key)
  if (entry === undefined) {
    return key
  }
  if (typeof entry === 'string') {
    return fill(entry, params)
  }
  const count = Number(params?.count ?? 0)
  const form = new Intl.PluralRules(locale).select(count)
  return fill(entry[form] ?? entry.other, params)
}
