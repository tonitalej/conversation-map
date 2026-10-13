# Architecture

## Platform decision

| Option                                             | Verdict                | Reason                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex plugin with a skill and a bundled script** | **Chosen**             | Plugins can bundle skills, and skills can ship helper scripts ([Plugins](https://developers.openai.com/codex/plugins), [Build plugins](https://developers.openai.com/codex/plugins/build)). Codex already has the conversation and a sandbox that can run Node and write files, so it can produce real artifacts. A repo marketplace (`.agents/plugins/marketplace.json`) lets the plugin be installed from this repository. |
| ChatGPT (Chat/Work) through the same plugin        | Possible, unverified   | ChatGPT and Codex share one plugin directory. Whether ChatGPT's execution environment runs Node scripts from a skill was not verified. The skill falls back to a clearly labelled, unvalidated Markdown outline when Node is unavailable.                                                                                                                                                                                    |
| ChatGPT app / MCP server with custom UI            | Not built              | It would need a hosted server and authentication, and the conversation would leave the user's machine. That is more infrastructure and data exposure than the job needs.                                                                                                                                                                                                                                                     |
| Standalone web app                                 | Not built as a product | The rendered HTML file _is_ a standalone, offline web app. A hosted version would need its own model access and API keys, which the brief rules out for client code.                                                                                                                                                                                                                                                         |

What was verified: the manifest (`.codex-plugin/plugin.json`), the skill layout, and the marketplace file
follow the documented formats. The bundled script runs under Node 18+ (bundle target) and was exercised on
Node 24.

What was not verified: installation in Codex CLI or the ChatGPT desktop app. Neither was available in the
development environment.

## Separation of concerns

```
transcript ──► ingest ──► Transcript ─┐
                                      ├─► build (validate + repair) ──► ConversationMap ──► render ──► .html / .md / .json
analysis.json (written by the LLM) ───┘                                       ▲
                                                                     validateMap (also run in the viewer)
```

The **LLM does the understanding**: it segments topics, classifies items, picks verbatim quotes, and links
relations. It writes an `AnalysisDraft`. Everything after that is **deterministic code** that can check the
draft and render it:

| Stage (brief §5)                                       | Where                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1 Ingestion, 2 normalization, 3 speaker preservation   | `src/ingest/transcript.ts`                                                         |
| 4 Segmentation, 5 topic discovery, 6 subtopic grouping | LLM, following `references/analysis-guide.md`                                      |
| 7 Semantic classification                              | LLM; rules enforced in `src/analysis/build.ts` (attribution, supersession, status) |
| 8 Evidence linking                                     | LLM picks quotes; `build.ts` verifies or relocates them                            |
| 9 Relation extraction                                  | LLM; `build.ts` validates the endpoints, derives `supersedes`, and flags conflicts |
| 10 Map construction                                    | `build.ts` (hierarchy repair, deduplication, deterministic ids)                    |
| 11 Validation                                          | `build.ts` + `src/analysis/validate-map.ts`                                        |
| 12 Rendering                                           | `src/render/html.ts`, `src/render/markdown.ts`, `src/viewer/*`                     |
| 13 Export                                              | CLI (`src/cli/run.ts`) and the viewer's export menu                                |
| 14 Error recovery                                      | Diagnostics with `repaired`, `--best-effort`, viewer fallback outline              |

**Bounded retries.** The skill tells the model to fix errors reported by `check` for at most two revision
rounds. After that it may build with `--best-effort`, and it must say so. The script itself never loops.

**Long transcripts.** `ingest` plans chunks of about 60k characters on message boundaries. The model writes
one draft per chunk, reusing the same keys for the same topics. `check` and `build` accept several drafts,
merge them by key, and deduplicate siblings. Coverage is `partial` whenever not every message was analyzed.

## Validation pipeline (`buildMap`)

Steps run in order:

1. **Merge drafts.** Nodes from different drafts with the same key, kind and classification are merged, and
   their evidence is unioned. A key reused within one draft, or reused with a different kind or
   classification, is an error. In the second case the later node is renamed.
2. **Resolve the hierarchy.** Unknown parents, items used as parents, cycles, and depth beyond 6 are
   re-parented to the nearest valid ancestor or the root. Each repair is reported.
3. **Deduplicate siblings.** Siblings with identical normalized titles and the same classification are
   merged. Very similar titles get a warning.
4. **Verify evidence.** Each quote is matched after normalization: NFKC, folded curly quotes and dashes,
   lowercase, collapsed whitespace, and `...` fragments in order. A quote found in exactly one _other_
   message is relocated there; otherwise it is marked unverified. Citations of messages that don't exist are
   removed.
5. **Classification rules.**
   - Evidence-requiring items with no verified quote are flagged `unsupported`.
   - A `user_statement` whose verified evidence is all from the assistant becomes an `assistant_statement`,
     and the reverse. Mixed speakers become `unknown`.
   - Owner and due values must appear in the cited text, or they are dropped.
   - `supersededBy` turns the older decision into `superseded_decision` and derives a `supersedes` relation.
   - A `contradicts` relation flags both ends as `in-conflict`.
   - Status is always derived from the classification.
6. **Relations.** Self-links, unknown endpoints, and duplicates are dropped.
7. **Assemble.**
   - Ids are the analyst's keys, slugified and de-collided deterministically.
   - Only messages cited as evidence are embedded.
   - Stats and the map id (an FNV-1a hash of the content) are computed.

Diagnostics have three levels. **Errors** mean the analyst should fix the draft, and `build` refuses to
write without `--best-effort`. **Warnings** are judgment calls. **Info** entries are notes, such as
instruction-like text in the transcript.

## Rendering

- **HTML** (`renderHtml`) produces one file. It contains:
  - a strict, hash-based Content-Security-Policy;
  - the minified viewer script and CSS, inlined;
  - the map as inert JSON in `<script type="application/json">`;
  - an HTML-escaped static outline, used as the no-JS, print and failure fallback.
- **Viewer** (`src/viewer`) is plain TypeScript with no framework.
  - `Store` holds all view state and batches change notifications per microtask.
  - `Canvas` uses `d3-hierarchy` for the tidy-tree layout, HTML cards over an SVG edge layer, pan/zoom/pinch,
    and arrow-key navigation.
  - `Explorer` is an ARIA tree. `Inspector` shows details and the overview. `Header` holds search, filters
    and export.
  - All DOM creation goes through `h()`, which writes text only as text nodes and allows a fixed list of
    attributes.
- **Markdown** (`renderMarkdown`) escapes every piece of conversation text so it cannot form links, images or
  HTML.

## Build and packaging

- `scripts/build.mjs` bundles the viewer (IIFE) and the CLI (ESM, Node 18 target, viewer assets inlined) into
  `plugins/conversation-map/skills/conversation-map/scripts/conversation-map.mjs`, about 150 KB.
- Runtime dependency: `d3-hierarchy` (ISC), bundled. Nothing is installed at runtime.
- Development: TypeScript (strict; run directly with Node type stripping), esbuild, Prettier, `node:test`,
  Playwright.

## Repository layout

```
.agents/plugins/marketplace.json        repo marketplace entry
plugins/conversation-map/               the plugin
  .codex-plugin/plugin.json             manifest
  assets/icon.svg
  skills/conversation-map/
    SKILL.md                            workflow for the model
    agents/openai.yaml                  skill UI metadata
    references/analysis-guide.md        classification and evidence rules
    references/analysis.schema.json     draft JSON Schema
    scripts/conversation-map.mjs        generated bundle (do not edit)
src/
  core/        model types, limits, text utilities
  ingest/      transcript parsing and chunk planning
  analysis/    draft parsing, map building, map validation
  render/      HTML shell, Markdown, labels
  viewer/      browser application
  eval/        gold-set scoring
  cli/         command-line entry point
scripts/       build and example generation
tests/         unit, integration, e2e
examples/      launch-planning transcript, analysis, gold labels, generated output
docs/          this documentation
```
