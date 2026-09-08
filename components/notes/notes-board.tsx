'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveComment, correctCommentIntent, type CommentRow } from '@/app/actions/comments';
import type { CommentIntent } from '@/lib/comment-intent';

const INTENTS: CommentIntent[] = ['preference', 'instruction', 'fact'];

export interface NotesBoardOptions {
  tasks: { id: string; label: string }[];
  projects: { id: string; label: string }[];
}

export function NotesBoard({ comments, options, labels }: {
  comments: CommentRow[];
  options: NotesBoardOptions;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [entityType, setEntityType] = useState<'general' | 'task' | 'project'>('general');
  const [entityId, setEntityId] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const entityChoices = useMemo(
    () => (entityType === 'task' ? options.tasks : entityType === 'project' ? options.projects : []),
    [entityType, options],
  );

  const submit = () => start(async () => {
    setFailure(null);
    const res = await saveComment({ body, entityType, entityId: entityType === 'general' ? null : entityId });
    if ('error' in res) { setFailure(res.error); return; }
    setBody(''); setEntityId('');
    router.refresh();
  });

  const reinterpret = (id: string, intent: string) => start(async () => {
    const res = await correctCommentIntent(id, intent);
    if (!('error' in res)) router.refresh();
  });

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      {/* Composer */}
      <section className="rounded-(--radius-card) border border-line bg-card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3">{labels.composerTitle}</p>
        <p className="mt-1 text-xs text-ink2">{labels.composerSub}</p>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder={labels.placeholder}
          className="mt-3 w-full rounded-lg border border-line bg-card2 px-3 py-2 text-sm text-ink outline-none focus:border-sage"
        />

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-ink2">
            <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.linkTo}</span>
            <select
              value={entityType}
              onChange={(e) => { setEntityType(e.target.value as 'general' | 'task' | 'project'); setEntityId(''); }}
              className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink"
            >
              <option value="general">{labels.linkGeneral}</option>
              <option value="task">{labels.linkTask}</option>
              <option value="project">{labels.linkProject}</option>
            </select>
          </label>
          {entityType !== 'general' && (
            <label className="block text-xs text-ink2">
              <span className="mb-0.5 block text-[10px] font-medium text-ink3">
                {entityType === 'task' ? labels.linkTask : labels.linkProject}
              </span>
              <select
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink"
              >
                <option value="">{labels.pick}</option>
                {entityChoices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={pending || !body.trim() || (entityType !== 'general' && !entityId)}
            onClick={submit}
            className="min-h-11 rounded-full bg-sage px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 sm:min-h-9"
          >
            {labels.save}
          </button>
          {failure && <span role="alert" className="text-[11px] font-semibold text-coral">{failure}</span>}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-ink3">{labels.noActionsNote}</p>
      </section>

      {/* List */}
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3">{labels.recentTitle}</p>
        {comments.length === 0 ? (
          <p className="mt-3 text-sm text-ink3">{labels.empty}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-line bg-card p-3">
                <p className="text-sm text-ink">{c.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink3">
                  <span className="rounded-full bg-inset px-2 py-0.5">{c.entityLabel}</span>
                  <label className="flex items-center gap-1">
                    <span>{labels.readAs}</span>
                    <select
                      value={c.intent}
                      disabled={pending}
                      onChange={(e) => reinterpret(c.id, e.target.value)}
                      className="rounded border border-line bg-card2 px-1.5 py-0.5 text-[11px] text-ink2"
                    >
                      {INTENTS.map((i) => <option key={i} value={i}>{labels[`intent.${i}`]}</option>)}
                    </select>
                  </label>
                  {c.intent !== c.suggestedIntent && <span className="text-apricot">{labels.corrected}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
