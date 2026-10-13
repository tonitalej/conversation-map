# Evaluation

## Dataset

`examples/launch-planning/` is a 17-message product-planning conversation. It was written to include:

- a rejected proposal, and a decision that was later superseded (a launch date moved);
- an unresolved conflict (a notebook limit against "unlimited" mockups);
- a false completion claim by the assistant, corrected by the user;
- action items with stated owners and dates, and a completed action;
- an unanswered compliance question;
- injection text and HTML inside a quoted email, plus emoji and Chinese text.

`gold.json` labels 21 reference items. Seven are marked `trap`: items that are easy to misclassify, such as
an unaccepted suggestion, a superseded date, an assistant's false claim, and an unanswered question.

**Caveat.** The same author wrote the transcript, `analysis.json`, and `gold.json`. The scores below
therefore show that the pipeline and scorer work end to end. They do **not** independently measure how
accurately a model analyzes conversations. A real evaluation needs model-generated drafts over
independently labelled transcripts.

## Metrics (`conversation-map eval <map.json> <gold.json>`)

Gold items are matched to map items greedily. A pair matches when it shares a verified message and has
title-token Jaccard ≥ 0.15, or has Jaccard ≥ 0.5 alone.

| Metric                           | Meaning                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| classificationAccuracy           | Share of matched items whose classification equals the gold label. |
| classificationPrecision / Recall | Over all candidate items and all gold items.                       |
| attributionAccuracy              | Matched items whose speakers equal the gold speaker.               |
| sourceTraceability               | Evidence-requiring items with at least one verified quote.         |
| unsupportedClaimRate             | Evidence-requiring items without a verified quote.                 |
| taskPrecision / Recall           | For `action_item` and `completed_action`.                          |
| trapErrors                       | Misclassified trap items.                                          |

## Results (run on the checked-in example)

```
goldItems 21 · candidateItems 22 · matched 21
classificationAccuracy 1.00 · precision 0.955 · recall 1.00
attributionAccuracy 0.95 · sourceTraceability 1.00 · unsupportedClaimRate 0.00
taskPrecision 1.00 · taskRecall 1.00 · trapErrors 0 / 7
```

- The extra candidate item is an `inference` ("QA is the constraint"), which the gold file does not label.
  It lowers precision.
- The attribution miss is the GDPR question. Its evidence includes the assistant's reply, so the node lists
  both speakers, while the gold label says the user asked it.

The scorer's own behaviour is covered by tests: it detects a misclassified trap item, counts unsupported
claims and missed gold items, and rejects malformed gold files (`tests/unit/schema-and-eval.test.ts`).
