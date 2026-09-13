import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { IntakePanel, type IntakeTab } from '@/components/upload/intake-panel';
import { ImportQueuePanel } from '@/components/upload/import-queue-panel';
import { DataInboxTriagePanel } from '@/components/upload/data-inbox-triage';
import { getImportQueueStats } from '@/lib/import-queue';
import { getDataInboxTriage } from '@/app/actions/data-inbox';
import { PILOT_MAX_DOCS, PILOT_BUDGET_USD } from '@/lib/data-inbox';
import { DEMO_BUDGET_USD } from '@/lib/claude';
import type { Project } from '@/lib/types';

export const dynamic = 'force-dynamic';
// Next.js Server Actions inherit their timeout from the PAGE they're
// invoked on, not the action file itself. runImportBatch (app/actions/
// import-queue.ts) is a serial loop of up to 15 LLM extraction passes — a
// live run of it took 6+ minutes for one batch (invoice_pdf's extra
// storage download, or just a slow model response, can stretch a single
// document well past a few seconds). Without this, the platform default
// timeout risks killing the request mid-document, leaving that one
// document claimed (processed_at set) but never actually processed or
// released for retry.
export const maxDuration = 300;

// Data Inbox: route-specific shell, one intake surface at a time, a vertical
// workflow panel and a processing queue bound to real `documents` rows.
export default async function UploadPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const [projectsQ, importStats, triage] = await Promise.all([
    supabase.from('projects').select('id,name').order('name'),
    // Real aggregate counts (stored/processed/waiting/failed) — the old
    // "133 waiting" figure quoted earlier tonight was stale; this always
    // reflects the live table, never a remembered number.
    getImportQueueStats(supabase),
    // Demo Safety Gate (Rotem, 2026-09-13): the three-group triage view is
    // now the primary surface for unprocessed documents — replaces the old
    // flat "recent imports" list. Already-processed documents pending human
    // review live on /inbox, not here; this page is about the decision of
    // WHETHER to process at all.
    getDataInboxTriage(),
  ]);
  const projects = (projectsQ.data ?? []) as Pick<Project, 'id' | 'name'>[];

  // Formats mirror the real branches in app/api/upload/route.ts. MBOX and MSG
  // appear in the spec's example but have no branch here, so they are not
  // offered. MP4 is stored and linked only — transcription is not built.
  const tabs: IntakeTab[] = [
    { id: 'email', label: t('upload.src_email'), formats: 'OLM · ZIP · EML · JSONL', accept: '.olm,.zip,.eml,.jsonl' },
    { id: 'meeting', label: t('upload.src_rec'), formats: 'MP4 · TXT · DOCX · PDF', accept: '.mp4,.txt,.docx,.pdf' },
    { id: 'document', label: t('upload.src_doc'), formats: 'PDF · XLSX · XLS · DOCX · CSV', accept: '.pdf,.xlsx,.xls,.docx,.csv' },
    { id: 'sheet', label: t('upload.src_sheet'), formats: t('upload.src_sheet_sub'), accept: '' },
  ];

  const steps = [
    { t: t('upload.step1'), d: t('upload.step1_d') },
    { t: t('upload.step2'), d: t('upload.step2_d') },
    { t: t('upload.step3'), d: t('upload.step3_d') },
    { t: t('upload.step4'), d: t('upload.step4_d') },
    { t: t('upload.step5'), d: t('upload.step5_d') },
  ];

  // The old route-specific header carried this environment banner; the global
  // header does not, so it renders here — full-bleed, above the page body.
  const envLabel = process.env.NEXT_PUBLIC_ENV_LABEL;

  return (
    <>
      {envLabel && (
        <div className="bg-sk-green-dark px-4 py-1.5 text-center text-[8px] font-[500] uppercase tracking-[0.04em] text-white">
          {envLabel}
        </div>
      )}
      <div className="sk-page mx-auto max-w-[1320px] space-y-5 px-4 pt-6 pb-16 sm:px-7">
        {/* Intro — spec §5-§6: copy on the start side, the human-approval card
            on the end side. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_250px]">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('upload.kicker')}</p>
            <h1 className="mt-1 text-[clamp(29px,3.2vw,36px)] font-[650] leading-[1.08] tracking-[-0.035em] text-sk-ink">
              {t('upload.statement')}
            </h1>
            <p className="mt-1.5 max-w-2xl text-[11px] leading-[1.5] text-sk-muted">{t('upload.sub')}</p>
          </div>
          {/* The four assurance strings were inline chips; the spec makes them
              a card with the first line as its heading. Same copy. */}
          <aside className="rounded-[11px] border border-sk-line-strong bg-sk-green-soft p-4.5">
            <strong className="block text-[14px] font-[650] leading-[1.25] text-sk-green">{t('upload.chip1')}</strong>
            {[t('upload.chip2'), t('upload.chip3'), t('upload.chip4')].map((chip) => (
              <span key={chip} className="mt-2 block border-t border-sk-line-strong pt-2 text-[11px] leading-[1.4] text-sk-text">
                {chip}
              </span>
            ))}
          </aside>
        </div>

        {/* Intake workspace beside the vertical workflow panel — spec §7, §13.
            The five steps were five wide horizontal cards, which §13 forbids. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2.8fr)_minmax(220px,1fr)]">
          <IntakePanel
            tabs={tabs}
            projects={projects.map((p) => p.name)}
            sheetInfo={t('upload.sheet_info')}
            sheetSettings={t('upload.sheet_settings')}
            pasteInstead={t('upload.paste_instead')}
            pasteTab={t('paste.tab')}
            dropLabels={{
              drop: t('upload.drop'),
              processing: t('upload.processing'),
              done: t('upload.done'),
              failed: t('upload.failed'),
              project: t('common.project'),
              all: t('common.none'),
              chooseFile: t('upload.choose_file'),
              nextStep: t('upload.review_ready'),
              retry: t('common.retry'),
              stored: t('upload.stored'),
              noTranscript: t('upload.no_transcript'),
              notProcessed: t('upload.not_processed'),
              invoiceTracker: t('upload.result_invoice_tracker'),
              taskTracker: t('upload.result_task_tracker'),
              emailBatch: t('upload.result_email_batch'),
              alreadyUploaded: t('upload.result_already_uploaded'),
              invoiceCreated: t('upload.result_invoice_created'),
              notAnInvoice: t('upload.result_not_an_invoice'),
              invoiceSkipped: t('upload.result_invoice_skipped'),
              bundleDone: t('upload.result_bundle'),
            }}
            pasteLabels={{
              kicker: t('paste.kicker'), title: t('paste.title'), sub: t('paste.sub'),
              ph: t('paste.ph'), btn: t('paste.btn'), working: t('paste.working'),
              openReview: t('paste.open_review'),
              resAuto: t('paste.res_auto'), resMatch: t('paste.res_match'), resNew: t('paste.res_new'),
              errMulti: t('paste.err_multi'),
              'err.short': t('paste.err_short'), 'err.long': t('paste.err_long'),
              'err.no_project': t('paste.err_project'), 'err.save': t('common.error_save'),
            }}
          />

          <aside className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('upload.next')}</p>
            <ol className="mt-2">
              {steps.map((step, i) => (
                <li key={step.t} className="flex gap-3 border-b border-line2 py-3 last:border-b-0">
                  <span aria-hidden="true" className="grid h-7 w-7 flex-none place-items-center rounded-full bg-sk-green-soft text-[10px] font-[650] text-sk-green">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-[650] text-sk-ink">{step.t}</span>
                    <span className="mt-0.5 block text-[10px] leading-[1.45] text-sk-muted">{step.d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </div>

        <p className="text-[10px] leading-[1.5] text-sk-muted">{t('upload.help')}</p>

        <ImportQueuePanel
          initialStats={importStats}
          labels={{
            title: t('upload.queue_stats_title'),
            stored: t('upload.queue_stat_stored'),
            processed: t('upload.queue_stat_processed'),
            waiting: t('upload.queue_stat_waiting'),
            failed: t('upload.queue_stat_failed'),
          }}
        />

        {/* Demo Safety Gate (Rotem, 2026-09-13): every stored-but-unprocessed
            document is triaged into exactly three groups, purely from
            deterministic signals — this is the ONLY surface that can trigger
            processing, capped at PILOT_MAX_DOCS per run and budget-gated. */}
        <DataInboxTriagePanel
          initialTriage={triage}
          pilotMaxDocs={PILOT_MAX_DOCS}
          pilotBudgetUsd={PILOT_BUDGET_USD}
          demoBudgetUsd={DEMO_BUDGET_USD}
          labels={{
            help: t('inbox_triage.help'),
            groupCandidate: t('inbox_triage.group_candidate'),
            groupCandidateD: t('inbox_triage.group_candidate_d'),
            groupNeedsSelection: t('inbox_triage.group_needs_selection'),
            groupNeedsSelectionD: t('inbox_triage.group_needs_selection_d'),
            groupDoNotProcess: t('inbox_triage.group_do_not_process'),
            groupDoNotProcessD: t('inbox_triage.group_do_not_process_d'),
            empty: t('inbox_triage.empty'),
            reasons: {
              no_extractable_text: t('inbox_triage.reason_no_extractable_text'),
              too_large: t('inbox_triage.reason_too_large'),
              project_ambiguous: t('inbox_triage.reason_project_ambiguous'),
              source_ambiguous: t('inbox_triage.reason_source_ambiguous'),
              no_project_signal: t('inbox_triage.reason_no_project_signal'),
              project_identified: t('inbox_triage.reason_project_identified'),
            },
            selectedCount: t('inbox_triage.selected_count'),
            processSelected: t('inbox_triage.process_selected'),
            processing: t('inbox_triage.processing'),
            resultTitle: t('inbox_triage.result_title'),
            outcomeSucceeded: t('inbox_triage.outcome_succeeded'),
            outcomeFailed: t('inbox_triage.outcome_failed'),
            outcomeBudgetBlocked: t('inbox_triage.outcome_budget_blocked'),
            budgetNote: t('inbox_triage.budget_note'),
            errorSave: t('inbox_triage.error_save'),
          }}
        />
      </div>
    </>
  );
}
