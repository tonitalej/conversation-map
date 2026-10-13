/** Hard bounds that keep processing and rendering predictable. Documented in docs/limitations.md. */
export const LIMITS = {
  transcriptBytes: 10 * 1024 * 1024,
  analysisBytes: 10 * 1024 * 1024,
  messages: 20_000,
  messageIdLength: 64,
  nodes: 3_000,
  relations: 6_000,
  depth: 6,
  evidencePerNode: 12,
  quoteChars: 600,
  quoteMinChars: 3,
  titleChars: 140,
  summaryChars: 1_200,
  detailChars: 6_000,
  rationaleChars: 1_200,
  noteChars: 1_000,
  notes: 50,
  ownerChars: 80,
  dueChars: 80,
  keyPattern: /^[a-z0-9][a-z0-9-]{0,63}$/,
  /** Suggested size of one analysis chunk for long transcripts. */
  chunkChars: 60_000,
} as const;

export const ROOT_ID = 'root';
