'use client';

import { useState, useTransition } from 'react';
import { confirmExistingTask, createTaskChecked, type DuplicateCandidate } from '@/app/actions/tasks';

interface Props {
  projects: { id: string; name: string }[];
  labels: Record<string, string>;
}

// Her .add-task green button + spec §י reconciliation dialog: submitting a
// new action first checks for similar open tasks in the same project; a
// match pops a confirmation asking "same task or genuinely new?".
export function AddAction({ projects, labels }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? '');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [waiting, setWaiting] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const reset = () => {
    setOpen(false);
    setTitle(''); setOwner(''); setDue(''); setWaiting('');
    setDuplicates(null); setFailed(false);
  };

  const submit = (force: boolean) => start(async () => {
    setFailed(false);
    const res = await createTaskChecked({
      projectId: projectId || null,
      title, owner, due: due || null, waitingFor: waiting, force,
    });
    if (res && 'duplicates' in res && res.duplicates) { setDuplicates(res.duplicates); return; }
    if (res && 'error' in res && res.error) { setFailed(true); return; }
    reset();
  });

  const pickExisting = (id: string) => start(async () => {
    setFailed(false);
    const res = await confirmExistingTask(id, title.trim());
    if (res?.error) { setFailed(true); return; }
    reset();
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 cursor-pointer rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:min-h-0"
      >
        {labels.addAction}
      </button>
    );
  }

  return (
    <>
      {/* Modal ground — clicking outside closes; Escape via key handler. */}
      <button
        type="button"
        aria-label={labels.cancel}
        onClick={reset}
        className="fixed inset-0 z-40 cursor-default bg-ink/30"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={labels.addAction}
        onKeyDown={(e) => { if (e.key === 'Escape') reset(); }}
        className="fixed inset-x-3 top-[12dvh] z-50 mx-auto max-w-md rounded-2xl border border-line bg-card p-5 shadow-card"
      >
        {duplicates === null ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink3">{labels.addAction}</p>
            <div className="mt-3 space-y-2.5">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={labels.titlePh}
                aria-label={labels.titlePh}
                className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
              />
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                aria-label={labels.project}
                className="min-h-11 w-full cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="">{labels.general}</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder={labels.owner}
                  aria-label={labels.owner}
                  className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
                />
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  aria-label={labels.due}
                  className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
                />
              </div>
              <input
                value={waiting}
                onChange={(e) => setWaiting(e.target.value)}
                placeholder={labels.waiting}
                aria-label={labels.waiting}
                className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
              />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                disabled={pending || !title.trim()}
                onClick={() => submit(false)}
                className="min-h-11 cursor-pointer rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:min-h-0"
              >
                {labels.save}
              </button>
              <button
                type="button"
                onClick={reset}
                className="min-h-11 cursor-pointer rounded-[9px] px-3 py-2 text-sm text-ink3 hover:text-ink sm:min-h-0"
              >
                {labels.cancel}
              </button>
              {failed && <span role="alert" className="text-xs text-coral">{labels.error}</span>}
            </div>
          </>
        ) : (
          <>
            {/* Reconciliation step — her Task Reconciliation contract:
                upsert or deduplicate before a new record exists. */}
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-apricot">{labels.dupKicker}</p>
            <h2 className="mt-1 font-serif text-lg text-ink">{labels.dupTitle}</h2>
            <p className="mt-1 text-xs text-ink2">{labels.dupSub.replace('{title}', title.trim())}</p>
            <ul className="mt-3 space-y-2">
              {duplicates.map((d) => (
                <li key={d.id} className="rounded-xl border border-line bg-card2 p-3">
                  <p className="text-sm font-medium text-ink">{d.title}</p>
                  <p className="mt-0.5 text-[11px] text-ink3">
                    {[d.owner, d.waiting_for ? `${labels.waiting}: ${d.waiting_for}` : null, d.due].filter(Boolean).join(' · ')}
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => pickExisting(d.id)}
                    className="mt-2 min-h-11 cursor-pointer rounded-full border border-sage-line px-3 py-1 text-xs text-sage hover:bg-sage-soft disabled:opacity-50 sm:min-h-0"
                  >
                    {labels.dupSame}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => submit(true)}
                className="min-h-11 cursor-pointer rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:min-h-0"
              >
                {labels.dupNew}
              </button>
              <button
                type="button"
                onClick={() => setDuplicates(null)}
                className="min-h-11 cursor-pointer rounded-[9px] px-3 py-2 text-sm text-ink3 hover:text-ink sm:min-h-0"
              >
                {labels.back}
              </button>
              {failed && <span role="alert" className="text-xs text-coral">{labels.error}</span>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
