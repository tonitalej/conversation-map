import { LIMITS } from '../core/limits.ts';
import type { Diagnostic, Message, Speaker, Transcript, TranscriptFormat } from '../core/model.ts';
import { isPlainObject, looksLikeInjectedInstruction, stripControl } from '../core/text.ts';

export class TranscriptError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'TranscriptError';
  }
}

const SPEAKER_ALIASES: Record<string, Speaker> = {
  user: 'user',
  human: 'user',
  me: 'user',
  you: 'user',
  customer: 'user',
  assistant: 'assistant',
  ai: 'assistant',
  bot: 'assistant',
  model: 'assistant',
  chatgpt: 'assistant',
  gpt: 'assistant',
  claude: 'assistant',
  gemini: 'assistant',
  codex: 'assistant',
  copilot: 'assistant',
  system: 'system',
  developer: 'system',
  tool: 'tool',
  function: 'tool',
};

export function speakerFromLabel(label: string): Speaker {
  return SPEAKER_ALIASES[label.trim().toLowerCase()] ?? 'other';
}

/**
 * Parse a transcript. `hint` is usually derived from the file extension; content sniffing
 * decides when the hint is absent or ambiguous.
 */
export function parseTranscript(raw: string, hint?: TranscriptFormat): Transcript {
  if (Buffer.byteLength(raw, 'utf8') > LIMITS.transcriptBytes) {
    throw new TranscriptError(
      'transcript-too-large',
      `Transcript exceeds ${LIMITS.transcriptBytes / (1024 * 1024)} MB. Split it and analyze the parts separately.`,
    );
  }
  const text = raw.replace(/^\uFEFF/, '');
  if (text.trim().length === 0) {
    throw new TranscriptError('transcript-empty', 'Transcript is empty.');
  }
  const format = hint ?? sniffFormat(text);
  const parsed = format === 'json' ? parseJson(text) : format === 'jsonl' ? parseJsonl(text) : parseText(text);
  return finalize(parsed.format, parsed.title, parsed.entries);
}

function sniffFormat(text: string): TranscriptFormat {
  const t = text.trimStart();
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
      try {
        JSON.parse(firstLine);
        return 'jsonl';
      } catch {
        return 'text';
      }
    }
  }
  return 'text';
}

interface RawEntry {
  id?: string;
  label: string;
  speaker: Speaker;
  text: string;
  timestamp?: string;
}

interface Parsed {
  format: TranscriptFormat;
  title?: string;
  entries: RawEntry[];
}

function parseJson(text: string): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new TranscriptError('transcript-invalid-json', `Transcript is not valid JSON: ${(err as Error).message}`);
  }
  let title: string | undefined;
  let list: unknown;
  if (Array.isArray(data)) {
    list = data;
  } else if (isPlainObject(data)) {
    list = data['messages'] ?? data['conversation'] ?? data['turns'];
    if (typeof data['title'] === 'string') title = data['title'];
  }
  if (!Array.isArray(list)) {
    throw new TranscriptError(
      'transcript-unsupported-json',
      'JSON transcript must be an array of messages or an object with a "messages" array.',
    );
  }
  return { format: 'json', title, entries: list.map((item, i) => entryFromObject(item, i)) };
}

function parseJsonl(text: string): Parsed {
  const entries: RawEntry[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, lineNo) => {
    if (line.trim() === '') return;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new TranscriptError('transcript-invalid-jsonl', `Line ${lineNo + 1} is not valid JSON.`);
    }
    entries.push(entryFromObject(obj, entries.length));
  });
  return { format: 'jsonl', entries };
}

function entryFromObject(item: unknown, position: number): RawEntry {
  if (!isPlainObject(item)) {
    throw new TranscriptError('transcript-invalid-message', `Message ${position + 1} is not an object.`);
  }
  const author = item['author'];
  const rawLabel =
    pickString(item, ['role', 'speaker', 'name', 'from', 'sender']) ??
    (isPlainObject(author) ? pickString(author, ['role', 'name']) : typeof author === 'string' ? author : undefined);
  if (!rawLabel) {
    throw new TranscriptError('transcript-missing-speaker', `Message ${position + 1} has no role or speaker.`);
  }
  const content = extractContent(item['content'] ?? item['text'] ?? item['message'] ?? item['parts']);
  if (content === undefined) {
    throw new TranscriptError('transcript-missing-content', `Message ${position + 1} has no text content.`);
  }
  const rawId = item['id'];
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined;
  const ts = pickString(item, ['timestamp', 'created_at', 'createdAt', 'time', 'date']);
  return { id, label: rawLabel, speaker: speakerFromLabel(rawLabel), text: content, timestamp: ts };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

function extractContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((p) => (typeof p === 'string' ? p : isPlainObject(p) && typeof p['text'] === 'string' ? p['text'] : ''))
      .filter((p) => p !== '');
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  if (isPlainObject(value)) {
    if (typeof value['text'] === 'string') return value['text'];
    if (Array.isArray(value['parts'])) return extractContent(value['parts']);
  }
  return undefined;
}

/**
 * Plain text / Markdown: a turn starts with a recognized speaker label, e.g.
 * `User: ...`, `**Assistant:** ...`, `## User`, `> Human: ...`. Unrecognized `Name:` prefixes
 * are not treated as speakers, because guessing would risk misattribution.
 */
const INLINE_LABEL = /^\s{0,3}(?:>\s*)?(?:\*\*|__)?([A-Za-z][A-Za-z ]{0,30}?)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s?(.*)$/;
const HEADING_LABEL = /^\s{0,3}#{1,6}\s+(?:\*\*|__)?([A-Za-z][A-Za-z ]{0,30}?)(?:\*\*|__)?\s*:?\s*$/;

function parseText(text: string): Parsed {
  const lines = text.split(/\r?\n/);
  const entries: RawEntry[] = [];
  let title: string | undefined;
  let current: RawEntry | null = null;
  let body: string[] = [];

  const flush = () => {
    if (current) {
      current.text = body.join('\n').trim();
      entries.push(current);
    }
    body = [];
  };

  for (const line of lines) {
    const turn = matchTurn(line);
    if (turn) {
      flush();
      current = { label: turn.label, speaker: turn.speaker, text: '' };
      if (turn.rest) body.push(turn.rest);
      continue;
    }
    if (!current) {
      const heading = /^#\s+(.+)$/.exec(line.trim());
      if (heading && !title) title = heading[1]!.trim();
      continue;
    }
    body.push(line);
  }
  flush();

  if (entries.length === 0) {
    throw new TranscriptError(
      'transcript-no-turns',
      'No speaker turns found. Prefix each turn with a label such as "User:" or "Assistant:", or supply JSON.',
    );
  }
  return { format: 'text', title, entries };
}

function matchTurn(line: string): { label: string; speaker: Speaker; rest: string } | null {
  const inline = INLINE_LABEL.exec(line);
  const heading = inline ? null : HEADING_LABEL.exec(line);
  const m = inline ?? heading;
  if (!m) return null;
  const label = m[1]!.trim();
  const speaker = speakerFromLabel(label.replace(/\s+(?:said|says|wrote)$/i, ''));
  if (speaker === 'other') return null;
  return { label, speaker, rest: inline ? (inline[2] ?? '') : '' };
}

function finalize(format: TranscriptFormat, title: string | undefined, entries: RawEntry[]): Transcript {
  const diagnostics: Diagnostic[] = [];
  if (entries.length === 0) throw new TranscriptError('transcript-empty', 'Transcript contains no messages.');
  if (entries.length > LIMITS.messages) {
    throw new TranscriptError(
      'transcript-too-many-messages',
      `Transcript has ${entries.length} messages; the limit is ${LIMITS.messages}.`,
    );
  }

  const suppliedIds = entries.map((e) => (e.id === undefined ? undefined : sanitizeId(e.id)));
  const usable = suppliedIds.every((id) => id !== undefined) && new Set(suppliedIds).size === suppliedIds.length;
  if (suppliedIds.some((id) => id !== undefined) && !usable) {
    diagnostics.push({
      level: 'warning',
      code: 'message-ids-replaced',
      message:
        'Supplied message ids were missing, invalid, or duplicated; positional ids (m1, m2, ...) are used instead.',
    });
  }

  const messages: Message[] = [];
  let injectionLike = 0;
  entries.forEach((e, index) => {
    const cleaned = stripControl(e.text);
    if (looksLikeInjectedInstruction(cleaned)) injectionLike++;
    const msg: Message = {
      id: usable ? suppliedIds[index]! : `m${index + 1}`,
      index,
      speaker: e.speaker,
      label: stripControl(e.label).slice(0, 40),
      text: cleaned,
    };
    if (e.timestamp) msg.timestamp = stripControl(e.timestamp).slice(0, 40);
    messages.push(msg);
  });

  if (messages.every((m) => m.text.trim() === '')) {
    throw new TranscriptError('transcript-empty', 'All messages in the transcript are empty.');
  }
  const empty = messages.filter((m) => m.text.trim() === '').length;
  if (empty > 0) {
    diagnostics.push({ level: 'info', code: 'empty-messages', message: `${empty} message(s) have no text.` });
  }
  if (injectionLike > 0) {
    diagnostics.push({
      level: 'info',
      code: 'instruction-like-content',
      message: `${injectionLike} message(s) contain text resembling instructions or markup. It was treated as conversation data only.`,
    });
  }
  return { format, title: title ? stripControl(title).slice(0, 140) : undefined, messages, diagnostics };
}

function sanitizeId(id: string): string | undefined {
  const trimmed = id.trim();
  if (trimmed === '' || trimmed.length > LIMITS.messageIdLength) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(trimmed)) return undefined;
  return trimmed;
}

export function formatFromPath(path: string): TranscriptFormat | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return 'text';
  return undefined;
}

/** Split a transcript into contiguous chunks of roughly `maxChars` for staged analysis. */
export function planChunks(
  messages: Message[],
  maxChars: number = LIMITS.chunkChars,
): { from: string; to: string; characters: number }[] {
  const chunks: { from: string; to: string; characters: number }[] = [];
  let start = 0;
  let size = 0;
  messages.forEach((m, i) => {
    const len = m.text.length;
    if (size > 0 && size + len > maxChars) {
      chunks.push({ from: messages[start]!.id, to: messages[i - 1]!.id, characters: size });
      start = i;
      size = 0;
    }
    size += len;
  });
  if (messages.length > 0)
    chunks.push({ from: messages[start]!.id, to: messages[messages.length - 1]!.id, characters: size });
  return chunks;
}
