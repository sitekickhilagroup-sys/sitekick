import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { DataInboxHeader } from '@/components/chrome/data-inbox-header';
import { IntakePanel, type IntakeTab } from '@/components/upload/intake-panel';
import type { DocumentRow, Project } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Data Inbox: route-specific shell, one intake surface at a time, a vertical
// workflow panel and a processing queue bound to real `documents` rows.
export default async function UploadPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const [projectsQ, docsQ, pendingQ] = await Promise.all([
    supabase.from('projects').select('id,name').order('name'),
    supabase.from('documents').select('id,kind,source,storage_path,received_at,processed_at')
      .order('received_at', { ascending: false }).limit(8),
    // Additive query, no migration: lets the queue show a real "Ready for
    // review" state instead of labelling everything Processed.
    supabase.from('agent_proposals').select('document_id').eq('state', 'pending'),
  ]);
  const projects = (projectsQ.data ?? []) as Pick<Project, 'id' | 'name'>[];
  const docs = (docsQ.data ?? []) as (Pick<DocumentRow, 'id' | 'kind' | 'source' | 'received_at' | 'processed_at'>
    & { storage_path: string | null })[];
  const readyIds = new Set(
    ((pendingQ.data ?? []) as { document_id: string | null }[])
      .map((p) => p.document_id).filter(Boolean) as string[],
  );

  // Formats mirror the real branches in app/api/upload/route.ts. MBOX and MSG
  // appear in the spec's example but have no branch here, so they are not
  // offered. MP4 is stored and linked only — transcription is not built.
  const tabs: IntakeTab[] = [
    { id: 'email', label: t('upload.src_email'), formats: 'OLM · ZIP · EML · JSONL', accept: '.olm,.zip,.eml,.jsonl' },
    { id: 'meeting', label: t('upload.src_rec'), formats: 'MP4 · TXT · DOCX', accept: '.mp4,.txt,.docx' },
    { id: 'document', label: t('upload.src_doc'), formats: 'PDF · XLSX · DOCX · CSV', accept: '.pdf,.xlsx,.xls,.docx,.csv' },
    { id: 'sheet', label: t('upload.src_sheet'), formats: t('upload.src_sheet_sub'), accept: '' },
  ];

  const steps = [
    { t: t('upload.step1'), d: t('upload.step1_d') },
    { t: t('upload.step2'), d: t('upload.step2_d') },
    { t: t('upload.step3'), d: t('upload.step3_d') },
    { t: t('upload.step4'), d: t('upload.step4_d') },
    { t: t('upload.step5'), d: t('upload.step5_d') },
  ];

  return (
    <>
      <DataInboxHeader />
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

        {/* Queue — spec §14-§15. Rendered unconditionally so zero documents
            shows an empty state rather than the section vanishing. */}
        <section aria-labelledby="queue-h" className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('upload.queue_recent')}</p>
            <h2 id="queue-h" className="sr-only">{t('upload.queue')}</h2>
          </div>

          {docs.length === 0 ? (
            <div className="py-11 text-center">
              <strong className="block text-[13px] font-[650] text-sk-ink">{t('upload.empty_t')}</strong>
              <p className="mt-1 text-[11px] leading-[1.5] text-sk-muted">{t('upload.empty_d')}</p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line2">
              {docs.map((doc) => {
                const ready = readyIds.has(doc.id);
                // `documents` has no filename column and the spec forbids a
                // migration here, so the name is recovered from storage_path
                // where the branch stored one; otherwise the source is shown.
                const name = doc.storage_path?.split('/').pop() ?? doc.source;
                return (
                  <li key={doc.id} className="grid grid-cols-[48px_minmax(0,1.5fr)_auto] items-center gap-3.5 py-3 sm:grid-cols-[48px_minmax(200px,1.5fr)_auto_minmax(180px,1fr)_auto]">
                    <span className="rounded-[6px] bg-sk-surface-soft px-1.5 py-1 text-center font-mono text-[9px] uppercase text-sk-muted">
                      {doc.kind}
                    </span>
                    <span className="min-w-0 truncate text-[11px] text-sk-ink"><bdi>{name}</bdi></span>
                    <span className="hidden font-mono text-[9px] text-sk-muted sm:inline"><bdi>{doc.received_at.slice(0, 10)}</bdi></span>
                    <span className={`hidden justify-self-start rounded-full px-2 py-1 text-[9px] font-[650] uppercase tracking-[0.06em] sm:inline ${
                      ready ? 'bg-sk-amber-halo text-sk-amber'
                      : doc.processed_at ? 'bg-sk-green-soft-strong text-sk-green'
                      : 'bg-sk-blue-soft text-sk-blue'
                    }`}>
                      {ready ? t('upload.st_ready') : doc.processed_at ? t('upload.st_processed') : t('upload.st_uploaded')}
                    </span>
                    {ready ? (
                      <Link href="/inbox" className="justify-self-end whitespace-nowrap text-[10px] font-[650] text-sk-green hover:underline">
                        {t('upload.review_ready')} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
                      </Link>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
