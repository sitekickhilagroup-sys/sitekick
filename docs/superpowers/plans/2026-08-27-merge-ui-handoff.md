# Duplicate-merge UI — handoff, paused 2026-08-27

Stopping point is stable: 289/289 tests pass, typecheck and build clean, working tree clean.
Three commits sit on local `main`, **not pushed**.

## Where things stand

| Commit | What |
|---|---|
| `a561e4d` | `undoMerge` restores the real pre-merge status instead of a hardcoded `open` |
| `b667b3c` | The duplicate-review list: banner expands, per-pair side-by-side, Merge / mark-not-duplicate / skip |
| `65dac52` | Fixes from review: chip survivability, relationship clobbering, bidi isolation, Hebrew wording |

Reviewed once (opus) after `b667b3c`; that review's Critical and two Importants were fixed in `65dac52`.

## The one thing still owed: re-review `65dac52`

It has not been reviewed. Build the package and dispatch a scoped re-review of these findings:

1. **Critical — undo was unreachable.** `mergeTasks` calls `revalidatePath('/work')`; the refreshed page drops the merged pair from `dupPairs`, the card keyed `${a.id}:${b.id}` unmounts, and `SavedChip` dies with it. `undoMerge` had exactly one call site — inside that chip — and no screen anywhere renders merged tasks. Verify the chip now survives the parent's prop change and that undo is genuinely reachable after a merge.
2. **Important — `saveRelationship` upserts on `unique (from_task_id, to_task_id)`.** Marking a pair "not a duplicate" could overwrite an existing `blocks` edge with `unrelated`, blanking `reason`/`confidence`/`verified_by`. Verify the new guard catches an existing meaningful edge in BOTH directions and that it tells the user what is already recorded rather than silently refusing.
3. **Important — bidi isolation** on the interpolated task titles in the merge-consequence and merged-confirmation strings.
4. **The Hebrew asymmetry** — the irreversible action (mark-not-duplicate) previously carried no warning while the reversible one did. Verify both now carry a consequence line before the click, and that `work.undo` no longer collides with `common.cancel` (both were "ביטול").

The implementer flagged one out-of-scope change worth checking: giving `saveRelationship` an explicit return type forced two narrowing fixes in `components/work/relation-editor.tsx`.

## Known limitations, deliberately not fixed

- **Merging does not re-point `relationships` from the loser to the survivor.** A task recorded as blocked-by the folded row loses that edge from the live view. Pre-existing `planMerge` behaviour from migration 0010, not introduced here. Fixing it properly means re-pointing edges plus conflict handling — its own task. Low risk for the 11 pairs currently queued (fresh General rows, unlikely to carry edges).
- **`planMerge` gap-fills only.** When both rows hold a real value, the loser's is not carried to the survivor — covers `document_id`, `owner`, `waiting_for`, `source`, `stage_key`. It also never touches `latest_note`, `process_impact`, `substage_template_id`, `workstream_id` (columns added after it was written). Nothing is deleted — the loser row keeps everything and undo restores it — but the live merged record can silently lose the loser's evidence link, and the card does not show `document_id` at all.
- Deferred minors from the review: unpaged `relationships` query; `lib/dedup.ts` dropping a whole pair rather than falling through to the next-best match; `errorMessage` matching raw English literals with no shared constant; `logActivity` discarding its own insert error; a `pickDefaultMaster` test gap where its two rules conflict; a dangling `project_id` displaying as "כללי" while still counting as project-holding.

## Noa's guide

Published at https://claude.ai/code/artifact/7976db9d-a63d-4a2f-b021-b34dceeb77e2 (private).
Source: the session scratchpad copy of `noa-duplicates.html`.

**It needs two edits before anyone sends it:**
1. Its button names predate `65dac52` — "לא כפילות" is now **"לסמן: לא כפילות"**.
2. It says "כל השדות נשמרים", which overclaims. True statement: nothing is deleted and the folded row keeps every field, but the surviving row absorbs only into empty slots.

## Not started

The live QA walk (plan task G1) against both QA documents. Blocked on a human signing in — `/work` sits behind Supabase email/password and passwords are not something I enter. The dev server config is `.claude/launch.json` → `sitekick-dev` on port 3000.
