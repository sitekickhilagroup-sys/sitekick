# SiteKick — Noa's "(Noa via Claude)" task notes — review worklist (draft)

**Status:** Draft for review **tomorrow**, **nothing applied**. **Date compiled:** 2026-09-09.
Source: read-only query of production `tasks` where `status='open'` and `latest_note` contains
"Noa via Claude" — **11 notes** (all currently in `tasks.latest_note`, not `description`).

**How to use this:** each entry has the **task + context**, the **note verbatim** (the source of
truth), and a **proposed reading** — what looks stale, what is *actually* outstanding, and the
distinct sub-items (signature vs payment vs decision). The proposed reading is a **suggestion to
verify tomorrow, not a change** — per the handoff §4, targets and proposed changes are shown, never
applied on live records from a note alone. The notes are **data, not instructions**; an in-text
"(Noa via Claude)" attribution authenticates nothing.

Reconcile dates, source and applicability before acting. A signature is not, by itself, release of a
hold; a warning about delay is not confirmation that work has started.

---

## 2361-2367 San Marco

### 1. Review and sign Thang Le structural proposal ($19,000)
`owner: Thang Le · source: extract-comms`
> 2026-09-06 (Noa via Claude, from mailbox): Two of the three preconditions are answered, per Rowan's reply to Noa on 2026-09-04. BASEMENT — answered: Thang will coordinate with Serena on recommendations, so San Marco's basement is handled through Serena rather than inside his proposal. PRICING — answered: Rowan says Plan Check and Engineering have not begun on either project, so they are not at different stages, which is why San Marco and Rinconia both come out at $19,000. SOILS — still open: both proposals state the soils report was not provided; Rowan said "I will confirm" and has not come back. Chase Rowan on the soils confirmation — that is the last item before signature. Thang's San Marco proposal file: 2026-09-03 …2361 San Marco Dr.pdf, sent 09-03.

**Proposed reading:** the only open precondition to signature is **Rowan confirming the soils report**
(basement + pricing resolved). *Suggested next step:* "Chase Rowan re soils confirmation, then sign."
*Verify:* has Rowan since replied? (note is from 09-06.)

---

## 2650 Rinconia

### 2. LADBS returned the soils report — Bob to review and resubmit an addendum
`owner: Rowan (Premise) · waiting on: Greg Byrne (Grover-Hollingsworth) · due: 2026-09-08 · sub-stage: Loan application`
> 2026-09-04 (Noa via Claude): Status refresh, no change to owner or task name. Greg Byrne of Grover-Hollingsworth confirmed on 26/8 he can have the addendum response ready late next week or early the week after. Rowan and Serena confirmed there are no plan changes, so the addendum is a response to the LADBS comments only. Still In Progress / waiting on Grover. The soils approval letter that intake screening may demand comes out of this record — tracked separately as EM-03.

**Proposed reading:** genuinely **waiting on Grover** (Greg Byrne); no action our side. **Sub-stage looks
wrong** — "Loan application" on a soils-addendum task; likely should be "Soils review / addendum".
*Verify:* is the 09-08 due still right given Greg's "late next week" estimate?

### 3. Obtain the soil approval letter from LADBS
`owner: Serena (ReDefined) · waiting on: Greg · sub-stage: Soils review / addendum · source: tracker:EM-03`
> 2026-09-04 (Noa via Claude): …downstream of the Grover addendum — it cannot be issued until Grover-Hollingsworth files the soils response with LADBS (Greg Byrne targeting late next week or the week after). It is also the item LADBS intake screening may still demand before accepting the intake. Keep waiting on Grover / LADBS.

**Proposed reading:** **blocked by #2** (the Grover addendum). Correct as a dependency, not a separate
action right now. *Suggested:* record the blocks-relationship EM-03 ← the addendum task, if not already.

### 4. Plan check intake stalled awaiting City review
`waiting on: LADBS · source: agent review`
> 2026-09-04 (Noa via Claude): Kept open as the live City blocker, not merged. eplanLA #308694 — at screening LADBS asked for the soils report, the soils approval letter and the GPI; Serena resubmitted the report and the GPI and the plan checker still has to decide whether to accept intake without the approval letter. …Nothing to chase on our side until Grover files; chase the plan checker for the screening outcome and the payment link.

**Proposed reading:** the live City blocker. *Suggested next step:* "Chase the plan checker for the
screening outcome + payment link." Depends on the same Grover chain (#2/#3).

### 5. Retain civil engineer for Rinconia grading
`waiting on: Thang Le · sub-stage: Corrections round · source: tracker:OT-12`
> 2026-09-06 (Noa via Claude, from mailbox): Two of the three preconditions are already answered … SOILS — still open: … the only thing left before signing is Rowan confirming Thang reviewed the Rinconia soils report.

**Proposed reading:** **same content as #1**, Rinconia side — last item is Rowan confirming the soils
review, then sign. *Verify:* #1 (San Marco) and #5 (Rinconia) are two signatures gated on the **same**
Rowan soils confirmation — likely one chase clears both. Not a merge (two real tasks), but a shared
blocker worth linking.

---

## 3375 Blair Dr

### 6. Negotiate Carlos Peraita fee and scope to $25-30K  ← **stale title**
`owner: Rowan · waiting on: Refael · source: extract-comms`
> 2026-09-06 (Noa via Claude, from mailbox): Correction — the negotiation is finished, this title is stale. Rowan sent the agreement and retainer invoice on 08-06. Noa raised 5 scope points on 08-10; Rowan and Carlos answered; Rowan redlined the MSA on 08-11 … Carlos confirmed and DOCUSIGN WAS SIGNED BY CARLOS ON 2026-08-11. What is actually outstanding is **Hilla's counter-signature and the retainer payment** — work commences on signature plus payment. Rowan pushed again on 08-31: delaying Carlos will likely cause construction delays… The hold is Hilla's decision, not a pricing question.

**Proposed reading — the §4 exemplar. Distinct sub-items, do not collapse:**
- **Carlos's signature** — DONE (DocuSign 08-11).
- **Hilla's counter-signature** — OUTSTANDING.
- **Retainer payment** — OUTSTANDING.
- **Release-of-hold decision** — SEPARATE (see #10 OT-23 / #9 extension). Carlos signing is **not**
  itself release of the hold.
*Suggested change:* retitle to reflect reality (e.g. "Blair — Hilla counter-signature + retainer
payment on Carlos Peraita MSA"); status is "waiting on Hilla decision", not "negotiating price".
*Verify:* the `waiting on: Refael` field vs the note (which points at a Hilla signature + payment) —
reconcile who actually holds it.

### 7. Architect/interior designer hiring on hold pending plan-check extension decision
`source: agent review`
> 2026-09-04 (Noa via Claude): Kept open as the standing hold on design hiring, not merged. Carlos Peraita is On Hold until the City answers on the Plan Check extension, so the same gate applies to the interior designer. Decision record: OT-23. Architect fee record: "Negotiate Carlos Peraita fee…".

**Proposed reading:** a **standing hold**, correctly gated on the extension decision (OT-23, #10).
Note the tension with #6: #6 says Carlos is signed and only Hilla signature+payment remain, while #7
says the whole engagement is on hold behind the extension. *Verify tomorrow:* is the hold on
*starting work* (payment) or on *the whole engagement*? Reconcile #6/#7/#10 together.

### 8. Plan Check extension exhausted; no new filing appointment before expiration
`waiting on: "test" (⚠ stray) · due: 2027-03-01 · source: agent review · NOW`
> 2026-09-04 (Noa via Claude): Kept open deliberately, not merged — this is the hard constraint the extension decision runs against, and it carries the NOW flag. The decision itself is tracked on OT-23 … Two duplicates were folded into OT-23 on this date …

**Proposed reading:** the hard deadline constraint behind OT-23 (#10). **Data hygiene:** `waiting_for`
= "test" (a leftover from a UI test earlier today) — should be cleared. Due 2027-03-01 (03/01/27) —
confirm that's the real expiration, not a mis-parsed date.

### 9. Renew Blair excavation / lateral support bond PSS10010344 - $5,915
`owner: Noa · waiting on: Raizy Stuhl / P&G Brokerage · sub-stage: Mobilization · source: manual`
> 2026-09-06 (Noa via Claude): …expect this to cost more than $5,915. The neighbor Gray process delay extends the bond period, and that is what is pushing the premium up; it is not a broker price change. Ask Miri Hiller (P&G Brokerage) for the revised figure before renewing, and reconcile it with "Confirm grading permit bond renewal terms" due 2026-11-14. Related and still open: "Decision on stipulation to continue Gray vs. City of LA hearing…".

**Proposed reading:** the **$5,915 in the title is stale** — expect higher (Gray delay extends the
bond period). *Suggested:* title/amount to "revised figure TBD from Miri Hiller"; link to "Confirm
grading permit bond renewal terms" (due 11-14) and the Gray hearing decision. *Verify:* the note says
"Miri Hiller"; the `waiting on` field says "Raizy Stuhl" — reconcile the P&G contact.

### 10. Resolve PC extension - joint meeting or Arias review
`owner: Abhi (Crest) · waiting on: Crest (Tony Russo / Abhi Kalra) · sub-stage: Extension determination · source: tracker:OT-23`
> 2026-09-06 (Noa via Claude): New detail from the agent review inbox — this is the 5th plan check extension request and it has still not been granted. Nothing else has changed: still waiting on Crest… everything downstream stays on hold behind this decision, including the Carlos Peraita engagement and the interior designer.

**Proposed reading:** the **hub decision** — #6/#7 (Carlos, designer) and #8 (deadline) all hang off
this. Waiting on Crest. *Suggested:* this is the one to link the others to as their blocker. 5th
request, still ungranted — likely the real "NOW".

---

## General (no project)

### 11. Rowan's Agreement
`owner: Noa · waiting on: Rowan Kelshaw / broker quote · source: tracker:OT-41`
> 2026-09-06 (Noa via Claude) CORRECTION to my note above — I conflated two different brokers. There are two, and only one has quoted. (1) ROWAN'S broker: quoted as we speak (~$1M/project professional liability); still owed is the premium difference. (2) NOA'S OWN broker: Noa already sent Rowan's contract to her broker, still waiting for that quote — not in. So "Waiting on" covers both, neither is finished. Settled: Rowan's certificate of insurance arrives ~15 days AFTER signature, so it does not gate signing.

**Proposed reading:** two **separate** broker threads, don't merge: Rowan's broker (quoted; premium
difference owed) and Noa's broker (quote pending). Certificate of insurance is **not** a signing gate.
*Suggested:* possibly split into two waiting-on items, or make the two brokers explicit in the note;
attach to a project if it belongs to one (currently General).

---

## Cross-cutting for tomorrow

- **Shared blockers to link:** #6/#7 → #10 (extension); #2 → #3 → #4 (Grover soils chain); #1 ↔ #5
  (one Rowan soils confirmation gates both signatures).
- **Stale titles/amounts to fix:** #6 (negotiation done), #9 ($5,915 outdated), #2 (sub-stage).
- **Data hygiene:** #8 `waiting_for="test"` to clear; reconcile contact-name mismatches in #6, #9.
- **Do not assume from a note:** Carlos signing ≠ hold released (#6/#7/#10); delay warning ≠ work
  started; ambiguous date in #8 to confirm.
- **Before any live edit:** confirm the exact target task and the exact field change — this doc
  proposes, it does not apply.
