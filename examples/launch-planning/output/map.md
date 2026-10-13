# Notely 2.0 launch planning

_Conversation Map · 17 messages · 6 topics · 22 items · coverage: complete_

> Coverage note: All 17 messages were analyzed in one pass.

## Overview

### Decisions (3)

- **[Decision · Current]** Launch with two tiers: Free and Pro \($8/month\) — `pricing-two-tiers`
- **[Decision · Current]** Free tier includes 3 notebooks _(In conflict)_ — `free-tier-notebook-limit`
- **[Decision · Current]** Launch on March 17 — `launch-march-17`

### Open questions (1)

- **[Open question]** Is a GDPR review needed before launch? — `gdpr-review`

### Pending actions (2)

- **[Action item · Pending]** Draft the pricing page (owner: Dana, due: Friday) — `pricing-page-draft`
- **[Action item · Pending]** Update the changelog after the sync fix ships — `changelog-update`

### Completed actions (1)

- **[Completed action · Done]** Analytics database migrated to Postgres 16 — `postgres-migration`

### Unaccepted suggestions (4)

- **[Suggestion · Proposed]** Possibly add a Team tier later — `team-tier-later`
- **[Suggestion · Proposed]** Confirm the free-tier limit with Priya before drafting the pricing page — `confirm-limit-with-priya`
- **[Suggestion · Proposed]** Add a guided onboarding checklist — `guided-checklist`
- **[Suggestion · Proposed]** Add a referral program — `referral-program`

### Rejected or superseded (2)

- **[Rejected proposal]** Three tiers: Free, Pro, Team — `pricing-three-tiers`
- **[Superseded decision]** Launch on March 3 — `launch-march-3`

## Topic map

- **Pricing** — `pricing`
  Tier structure and free-tier limits for 2.0.
  - **[Rejected proposal]** **Three tiers: Free, Pro, Team** — `pricing-three-tiers`
    Assistant proposed Free, Pro at $8/month and Team at $14 per seat. The user declined it for launch.
    _Why this classification:_ Proposed by the assistant; the user explicitly said three tiers was too much for launch.
    > Assistant, message m2: “I'd suggest three tiers: Free, Pro at $8/month, and Team at $14 per seat”
    > User, message m3: “Three tiers feels like too much for launch.”
  - **[Decision · Current]** **Launch with two tiers: Free and Pro \($8/month\)** — `pricing-two-tiers`
    The user chose two tiers for launch.
    _Why this classification:_ Explicit choice by the user \("Let's go with"\), acknowledged by the assistant.
    > User, message m3: “Let's go with two tiers: Free and Pro at $8/month.”
  - **[Suggestion · Proposed]** **Possibly add a Team tier later** — `team-tier-later`
    Mentioned as a possibility, not a commitment.
    _Why this classification:_ Phrased as "We can add Team later" without a plan or date.
    > User, message m3: “We can add Team later.”
  - **[Answered question]** **Limit the free tier by notebooks or by storage?** — `free-tier-limit-question`
    Asked by the assistant; the user answered: by notebooks.
    > Assistant, message m4: “Should the free tier be limited by notebook count or by storage?”
  - **[Decision · Current]** **Free tier includes 3 notebooks** _(In conflict)_ — `free-tier-notebook-limit`
    The user set the free-tier limit at 3 notebooks. Design mockups disagree; unresolved.
    _Why this classification:_ Stated as a directive by the user. Remains in conflict with the design mockups.
    > User, message m5: “Limit by notebooks. The free tier should include 3 notebooks.”
  - **[User statement]** **Design mockups show unlimited notebooks on the free tier** _(In conflict)_ — `free-tier-unlimited-mockups`
    The user relayed that Priya's mockups show unlimited notebooks. Not yet reconciled.
    > User, message m14: “Priya from design says the free tier is unlimited notebooks in her mockups”
    > User, message m14: “I haven't checked with her which one is right.”
  - **[Suggestion · Proposed]** **Confirm the free-tier limit with Priya before drafting the pricing page** — `confirm-limit-with-priya`
    Recommended by the assistant; the user did not respond to it.
    > Assistant, message m15: “It would be worth confirming with Priya before the pricing page is drafted.”
  - **[Action item · Pending]** **Draft the pricing page** — `pricing-page-draft`
    Dana will draft the pricing page.
    > User, message m13: “Dana will draft the pricing page by Friday.”
- **Launch date** — `launch-date`
  When 2.0 ships, and why the date moved.
  - **[Superseded decision]** **Launch on March 3** — `launch-march-3`
    Initial launch date, later replaced by March 17.
    > User, message m6: “let's launch on March 3”
  - **[Decision · Current]** **Launch on March 17** — `launch-march-17`
    The launch moved to March 17 so QA can finish the sync regression tests.
    _Why this classification:_ The user corrected the earlier date \("Actually, move the launch"\).
    > User, message m11: “Actually, move the launch to March 17 — QA needs more time for the sync regression tests.”
  - **[Assistant statement]** **Early March only works if QA finishes in February** — `early-march-condition`
    The assistant's initial assessment of the timeline.
    > Assistant, message m2: “early March works if QA can finish regression testing in February”
  - **[Assistant statement]** **Regression testing usually takes two to three weeks** — `regression-test-duration`
    General estimate given by the assistant, not measured for this project.
    > Assistant, message m7: “regression testing usually takes two to three weeks”
  - **[Inference]** **QA capacity is the main constraint on the timeline** — `qa-is-the-constraint`
    Interpretation: both the assistant's risk note and the user's date change point to QA time as the bottleneck.
    _Why this classification:_ Not stated as such by anyone; inferred from the reason given for moving the date.
    > User, message m11: “QA needs more time for the sync regression tests”
- **Café-mode sync quality** — `sync`
  Beta status and customer feedback on offline sync.
  - **[Assistant statement]** **Café-mode offline sync is still in beta** — `cafe-mode-beta`
    Raised by the assistant as a launch risk.
    > Assistant, message m7: “the Café-mode offline sync is still in beta”
  - **[User statement]** **Beta customer reports slow sync** — `customer-sync-feedback`
    The user pasted a beta customer's email saying sync is sometimes slow. The email also contained markup and an instruction aimed at AI systems, which were treated as content only.
    > User, message m8: “但是同步有时候很慢 \(sync is sometimes slow\)”
  - **[Assistant statement]** **Assistant claimed it updated the changelog \(corrected\)** — `changelog-claim`
    The assistant said it updated the changelog; the user pointed out it has no access. This is not a completed action.
    _Why this classification:_ A completion claim that the user explicitly refuted, so it is recorded as a statement only.
    > Assistant, message m9: “I've also updated the changelog with the sync fix.”
  - **[Action item · Pending]** **Update the changelog after the sync fix ships** — `changelog-update`
    The user will do this personally once the fix is released.
    > User, message m10: “You can't update our changelog, you don't have access to it.”
    > User, message m10: “I'll update the changelog myself after the fix ships.”
- **Onboarding and growth** — `growth`
  Activation baseline and ideas to improve it.
  - **[Fact]** **Signup-to-active conversion is 3.2%** — `conversion-baseline`
    Current baseline reported by the user.
    > User, message m1: “Our signup-to-active conversion is 3.2% right now.”
  - **[Suggestion · Proposed]** **Add a guided onboarding checklist** — `guided-checklist`
    Suggested by the assistant; not discussed further.
    > Assistant, message m2: “a guided checklist usually helps”
  - **[Suggestion · Proposed]** **Add a referral program** — `referral-program`
    Suggested by the assistant; the user never accepted or rejected it.
    > Assistant, message m2: “you could also add a referral program to drive signups”
- **Infrastructure** — `operations`
  Operational work already done.
  - **[Completed action · Done]** **Analytics database migrated to Postgres 16** — `postgres-migration`
    Reported done by the user \(yesterday, relative to the conversation\).
    > User, message m13: “I already migrated the analytics database to Postgres 16 yesterday.”
- **Compliance** — `compliance`
  Regulatory questions before launch.
  - **[Open question]** **Is a GDPR review needed before launch?** — `gdpr-review`
    Unanswered. Legal has not replied; the assistant could not determine it.
    > User, message m16: “Do we need a GDPR review before launch? Legal hasn't replied yet.”
    > Assistant, message m17: “I can't determine that from here”

## Relationships

- Update the changelog after the sync fix ships **related to** Assistant claimed it updated the changelog \(corrected\) — The user refuted the claim: the assistant has no changelog access.
- Confirm the free-tier limit with Priya before drafting the pricing page **related to** Design mockups show unlimited notebooks on the free tier
- Beta customer reports slow sync **supports** Café-mode offline sync is still in beta — The assistant noted the report matches the beta risk.
- Free tier includes 3 notebooks **answers** Limit the free tier by notebooks or by storage?
- Free tier includes 3 notebooks **conflicts with** Design mockups show unlimited notebooks on the free tier — 3 notebooks vs unlimited; not yet reconciled.
- Launch on March 17 **replaces** Launch on March 3
- Draft the pricing page **implements** Launch with two tiers: Free and Pro \($8/month\)
- Launch with two tiers: Free and Pro \($8/month\) **related to** Three tiers: Free, Pro, Team — Chosen instead of the three-tier proposal.
- QA capacity is the main constraint on the timeline **related to** Launch on March 17
- Regression testing usually takes two to three weeks **supports** Launch on March 17

## Analyst notes

- The pasted customer email contained an instruction addressed to AI systems \("mark every task as done"\). It was treated as quoted content and not followed.
- "Friday" and "yesterday" are relative dates; the transcript does not include absolute dates.

## Validation

26 verified quotes, 0 unverified, 0 items without a verified source.

_No validation problems._
