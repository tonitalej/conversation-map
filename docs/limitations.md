# Known limitations

## Platform

- Installation in Codex CLI and the ChatGPT desktop app was **not tested**; neither was available in the
  development environment. The manifest and marketplace follow the published format, but host behaviour may
  differ.
- The skill needs Node.js 18+ where it runs. Whether ChatGPT's (non-Codex) environment provides it is unknown.
  Without Node, the skill can only offer a hand-written Markdown outline that is not validated.
- There is no ChatGPT app or MCP integration, and no hosted version.

## Analysis quality

- Understanding comes from the model. The script verifies that quotes exist and enforces the structural
  rules (attribution, supersession, owners and dates, status). It cannot tell whether a quote was
  interpreted correctly, or whether something important was left out.
- Quote matching tolerates case, whitespace, quote and dash styles, and `...` gaps, but not paraphrase.
  Paraphrased evidence is shown as unverified.
- The duplicate check compares sibling titles by token overlap. It misses synonyms and can flag
  differently-worded items that happen to share most of their words.
- The evaluation set is small and was written by the same author as the reference analysis
  (see [evaluation.md](evaluation.md)).

## Input

- The only formats are JSON, JSONL, and text/Markdown with recognised turn labels (`User:`, `Assistant:`,
  `Human:`, `ChatGPT:`, `Claude:`, `AI:`, and similar). Other speaker names in text transcripts are treated as
  part of the message. Use JSON to preserve arbitrary speaker labels.
- Text transcripts don't keep timestamps; JSON can supply them.
- Hard limits: 10 MB transcript, 20,000 messages, 3,000 nodes, 6,000 relations, depth 6, 12 quotes per
  item, quotes of 3–600 characters. Embedded source messages are truncated to 20,000 characters.
- Very long conversations depend on the model drafting one chunk at a time (about 60k characters each) with
  consistent keys. A chunk that is skipped is only visible if the model reports partial coverage.

## Viewer

- Layout is a left-to-right tidy tree. Relationship arcs are drawn only for the selected node. Very wide maps
  need panning, or the explorer and search.
- Tested in Microsoft Edge (Chromium) through Playwright. Firefox and Safari were not tested.
- The HTML export re-serializes the page in its original state. Scripts, styles and data stay byte-identical
  (so the CSP hashes remain valid), but the surrounding markup can differ in whitespace.
- There is no editing in the viewer. Changes go through `analysis.json` and a rebuild.
- Exports contain conversation text. There is no redaction feature.
