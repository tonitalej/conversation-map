# Map data model (schema version 1)

There are two documents:

- **`AnalysisDraft`** (`analysis.json`) is what the analyst writes. It is specified by
  [`analysis.schema.json`](../plugins/conversation-map/skills/conversation-map/references/analysis.schema.json)
  and explained in the [analysis guide](../plugins/conversation-map/skills/conversation-map/references/analysis-guide.md).
- **`ConversationMap`** (`map.json`, also embedded in `map.html`) is the validated output described here. The
  TypeScript source of truth is `src/core/model.ts`. A test keeps the JSON Schema enums and limits in sync
  with the code.

## ConversationMap

| Field           | Type            | Notes                                                                                           |
| --------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `schemaVersion` | `"1"`           | Bumped on breaking changes.                                                                     |
| `generator`     | string          | For example `conversation-map/1.0.0`.                                                           |
| `id`            | string          | Deterministic hash of the content. The same inputs give the same id.                            |
| `title`         | string          |                                                                                                 |
| `source`        | object          | `format` (`json`/`jsonl`/`text`), `messageCount`, `speakers` (count per speaker), `characters`. |
| `coverage`      | object          | `status`: `complete` or `partial`; optional `note`.                                             |
| `rootId`        | string          | Always `root`.                                                                                  |
| `nodes`         | MapNode[]       | Root first, then depth-first order.                                                             |
| `relations`     | Relation[]      | Cross-links between nodes.                                                                      |
| `messages`      | SourceMessage[] | **Only messages cited as evidence**, each truncated to 20,000 characters.                       |
| `analystNotes`  | string[]        | Caveats from the analyst.                                                                       |
| `diagnostics`   | Diagnostic[]    | Everything the pipeline checked, repaired or noticed.                                           |
| `stats`         | MapStats        | Counts for the overview.                                                                        |

### MapNode

| Field                 | Type                        | Notes                                                                                  |
| --------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `id`                  | string                      | `^[a-z0-9][a-z0-9-]{0,63}$`, unique.                                                   |
| `parentId`            | string \| null              | `null` only for the root.                                                              |
| `childIds`            | string[]                    | Ordered. Items never have children.                                                    |
| `depth`               | number                      | Root 0, at most 6.                                                                     |
| `kind`                | `root` \| `topic` \| `item` |                                                                                        |
| `classification`      | Classification              | Items only.                                                                            |
| `status`              | Status                      | Derived from the classification (see below). `none` for the root and topics.           |
| `title`, `summary`    | string                      |                                                                                        |
| `detail`, `rationale` | string?                     | `rationale` explains the classification.                                               |
| `evidence`            | Evidence[]                  | Up to 12.                                                                              |
| `speakers`            | Speaker[]                   | Speakers of _verified_ evidence, in first-seen order.                                  |
| `owner`, `due`        | string?                     | Present only when found in the cited message text.                                     |
| `flags`               | NodeFlag[]                  | `unsupported`, `unverified-evidence`, `attribution-mismatch`, `in-conflict`, `merged`. |

### Classification and status

| Classification                                  | Status       | Needs evidence                          |
| ----------------------------------------------- | ------------ | --------------------------------------- |
| `user_statement`, `assistant_statement`, `fact` | `none`       | yes                                     |
| `suggestion`                                    | `proposed`   | yes                                     |
| `decision`                                      | `active`     | yes                                     |
| `rejected_proposal`                             | `rejected`   | yes                                     |
| `superseded_decision`                           | `superseded` | yes                                     |
| `open_question`                                 | `open`       | yes                                     |
| `answered_question`                             | `answered`   | yes                                     |
| `action_item`                                   | `pending`    | yes                                     |
| `completed_action`                              | `done`       | yes                                     |
| `inference`                                     | `none`       | no (it is the analyst's interpretation) |
| `unknown`                                       | `none`       | no                                      |

`answered_question` goes beyond the brief's list of categories. It keeps answered questions from being
counted as open.

### Evidence

`{ messageId, quote, verified, speaker?, label?, index? }`

- `verified` is `true` only when the quote was found in that message after normalization: Unicode NFKC,
  folded curly quotes and dashes, lowercase, collapsed whitespace, and `...` fragments in order.
- `speaker`, `label` and `index` come from the message, never from the analyst.

### Relation

`{ id, from, to, type, note?, derived }`

- `type` is one of `supports`, `contradicts`, `supersedes`, `answers`, `implements`, `depends_on`, `related`.
- `derived` is `true` when the pipeline created the relation (from `supersededBy`).

### SourceMessage

`{ id, index, speaker, label, text, timestamp? }`

- `speaker` is one of `user`, `assistant`, `system`, `tool`, `other`.
- `label` is the original speaker label.
- `timestamp` is present only when the transcript supplied one.

### Diagnostic

`{ level: 'error' | 'warning' | 'info', code, message, node?, repaired? }`

### Invariants (checked by `validateMap`, in the CLI and in the viewer)

- Node ids are unique. There is exactly one root, and it has no parent.
- Every parent lists its child, and every child points back to its parent.
- Every node is reachable from the root. There are no cycles.
- Items have a valid classification, their status matches it, and they have no children.
- Relation types are valid, endpoints exist, and relation ids are unique.

## Versioning

- Additive, optional fields keep `schemaVersion: "1"`.
- Removing or changing the meaning of a field requires `"2"` and a migration in the renderer.
- The viewer refuses maps whose `schemaVersion` it does not know, and shows the static outline instead.
