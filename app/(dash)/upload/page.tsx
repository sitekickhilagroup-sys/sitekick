import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { Dropzone } from './dropzone';
import type { DocumentRow, Project } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Her "Data Inbox" page: assurance chips, source-type cards, the real
// dropzone, a 5-step "what happens next" strip and a processing queue of
// recent documents that links into the Review Inbox.
export default async function UploadPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const [projectsQ, docsQ] = await Promise.all([
    supabase.from('projects').select('id,name').order('name'),
    supabase.from('documents').select('id,kind,source,received_at,processed_at').order('received_at', { ascending: false }).limit(8),
  ]);
  const projects = (projectsQ.data ?? []) as Pick<Project, 'id' | 'name'>[];
  const docs = (docsQ.data ?? []) as Pick<DocumentRow, 'id' | 'kind' | 'source' | 'received_at' | 'processed_at'>[];

  const sources = [
    { title: t('upload.src_email'), sub: 'OLM · ZIP · EML · JSONL' },
    { title: t('upload.src_rec'), sub: 'MP4 · TXT · DOCX' },
    { title: t('upload.src_doc'), sub: 'PDF · XLSX · DOCX · CSV' },
    { title: t('upload.src_sheet'), sub: t('upload.src_sheet_sub') },
  ];
  const steps = [
    t('upload.step1'), t('upload.step2'), t('upload.step3'), t('upload.step4'), t('upload.step5'),
  ];

  return (
    <div className="space-y-5 pb-16">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('upload.kicker')}</p>
        <h1 className="mt-1 font-serif text-2xl text-ink sm:text-3xl">{t('upload.statement')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink3">{t('upload.sub')}</p>
        <p className="mt-2 flex flex-wrap gap-1.5">
          {[t('upload.chip1'), t('upload.chip2'), t('upload.chip3'), t('upload.chip4')].map((chip) => (
            <span key={chip} className="rounded-full bg-sage-soft px-2.5 py-0.5 text-[11px] text-sage">{chip}</span>
          ))}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {sources.map((s) => (
          <article key={s.title} className="rounded-(--radius-card) border border-line bg-card px-3.5 py-3 shadow-card">
            <p className="text-sm font-semibold text-ink">{s.title}</p>
            <p className="mt-0.5 font-mono text-[11px] text-ink3">{s.sub}</p>
          </article>
        ))}
      </div>

      <Dropzone
        projects={projects.map((p) => p.name)}
        labels={{
          drop: t('upload.drop'),
          processing: t('upload.processing'),
          done: t('upload.done'),
          failed: t('upload.failed'),
          project: t('common.project'),
          all: t('common.none'),
        }}
      />
      <p className="text-xs text-ink3">{t('upload.help')}</p>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink3">{t('upload.next')}</p>
        <ol className="mt-2 grid gap-2 sm:grid-cols-5">
          {steps.map((step, i) => (
            <li key={step} className="rounded-(--radius-card) border border-line bg-card px-3 py-2">
              <span className="font-mono text-[11px] text-sage">{i + 1}</span>
              <span className="ms-2 text-xs font-medium text-ink">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {docs.length > 0 && (
        <section aria-labelledby="queue-h">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="queue-h" className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink3">{t('upload.queue')}</h2>
            <Link href="/inbox" className="text-[11px] text-mist hover:underline">
              {t('upload.review_ready')} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-line2 rounded-(--radius-card) border border-line bg-card shadow-card">
            {docs.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                <span className="rounded-md bg-inset px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink3">{doc.kind}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink2">{doc.source}</span>
                <span className="font-mono text-[11px] text-ink3"><bdi>{doc.received_at.slice(0, 10)}</bdi></span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                  doc.processed_at ? 'bg-sage-soft text-sage' : 'bg-mist-soft text-mist'
                }`}>
                  {doc.processed_at ? t('upload.st_processed') : t('upload.st_uploaded')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
