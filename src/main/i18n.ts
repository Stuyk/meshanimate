import { app } from 'electron'
import { pickLocale, translate, type MessageKey, type Params } from '../shared/i18n'

let locale: string | null = null

/** Translated text for dialogs and errors, in the system language when it's supported. */
export function t(key: MessageKey, params?: Params): string {
  if (locale === null && app.isReady()) {
    locale = pickLocale(app.getPreferredSystemLanguages())
  }
  return translate(locale ?? 'en', key, params)
}
