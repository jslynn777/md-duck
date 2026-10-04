export type Locale = 'zh' | 'en';

export const locales: readonly Locale[] = ['zh', 'en'];
export const localizedPages = ['/', '/guide/', '/download/'] as const;

export function currentLocale(path: string): Locale {
  return /^\/en(?:\/|$|[?#])/.test(path) ? 'en' : 'zh';
}

/** Localize a site path while keeping its query string and fragment. */
export function localizePath(path: string, locale: Locale): string {
  const suffixIndex = path.search(/[?#]/);
  const suffix = suffixIndex < 0 ? '' : path.slice(suffixIndex);
  const pathname = suffixIndex < 0 ? path : path.slice(0, suffixIndex);
  let base = pathname.replace(/^\/en(?=\/|$)/, '') || '/';
  if (!base.startsWith('/')) base = `/${base}`;
  if (/^\/404(?:\.html)?\/?$/.test(base)) {
    return (locale === 'en' ? '/en/404/' : '/404.html') + suffix;
  }
  if (!base.endsWith('/') && !/\.[^/]+$/.test(base)) base += '/';
  return (locale === 'en' ? `/en${base}` : base) + suffix;
}

export function alternatePath(path: string): string {
  return localizePath(path, currentLocale(path) === 'en' ? 'zh' : 'en');
}
