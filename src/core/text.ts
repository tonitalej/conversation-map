/** Text helpers shared by ingestion, validation, and evaluation. */

const QUOTE_MAP: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u2032': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2033': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
  '\u00A0': ' ',
};

/**
 * Normalization used for evidence matching: Unicode NFKC, typographic quotes and dashes
 * folded to ASCII, case folded, whitespace collapsed. Deliberately does not strip
 * punctuation or words, so a "verified" quote really is present in the message.
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFKC')
    .replace(
      /[\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u2033\u2013\u2014\u2212\u00A0]/g,
      (c) => QUOTE_MAP[c] ?? c,
    )
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Coarser normalization for comparing titles (dedupe, evaluation matching). */
export function normalizeTitle(input: string): string {
  return normalizeForMatch(input)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(input: string): Set<string> {
  return new Set(
    normalizeTitle(input)
      .split(' ')
      .filter((t) => t.length > 1),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * True when `quote` occurs in `text`. An ellipsis ("..." or "…") in the quote splits it into
 * fragments that must all occur, in order.
 */
export function quoteOccursIn(quote: string, text: string): boolean {
  const haystack = normalizeForMatch(text);
  const fragments = normalizeForMatch(quote)
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  if (fragments.length === 0) return false;
  let from = 0;
  for (const fragment of fragments) {
    const at = haystack.indexOf(fragment, from);
    if (at < 0) return false;
    from = at + fragment.length;
  }
  return true;
}

/** Remove control characters (except tab/newline) that have no business in display text. */
export function stripControl(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
}

export function truncate(input: string, max: number): string {
  const chars = Array.from(input);
  if (chars.length <= max) return input;
  return chars.slice(0, Math.max(0, max - 1)).join('') + '…';
}

export function charLength(input: string): number {
  return Array.from(input).length;
}

/** 32-bit FNV-1a, rendered base36. Used for content-derived, stable identifiers (not security). */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Phrases commonly used to smuggle instructions into content that should be treated as data. */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|prompts?|rules)\b/i,
  /\bdisregard (?:all |any )?(?:the )?(?:previous|prior|above|system) (?:instructions|prompts?)\b/i,
  /\byou are now\b.{0,40}\b(?:mode|assistant|ai|model)\b/i,
  /\b(?:reveal|print|show|output) (?:your |the )?(?:system prompt|hidden instructions|api key|secrets?)\b/i,
  /<\s*script\b/i,
];

export function looksLikeInjectedInstruction(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((p) => p.test(text));
}
