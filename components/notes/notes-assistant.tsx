'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveComment, correctCommentIntent, type CommentRow } from '@/app/actions/comments';
import type { CommentIntent } from '@/lib/comment-intent';

const INTENTS: CommentIntent[] = ['preference', 'instruction', 'fact'];

export interface NotesAssistantOptions {
  tasks: { id: string; label: string }[];
  projects: { id: string; label: string }[];
}

/**
 * Global floating notes assistant — always docked at the bottom of every screen.
 * Noa writes a note; it is recorded (saveComment) and the assistant reflects how
 * it read the intent, which she can correct inline. v1 performs NO business
 * action — it is a running record of what she tells the system, not a doer.
 */
export function NotesAssistant({ comments, options, labels }: {
  comments: CommentRow[];
  options: NotesAssistantOptions;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [entityType, setEntityType] = useState<'general' | 'task' | 'project'>('general');
  const [entityId, setEntityId] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const threadRef = useRef<HTMLDivElement>(null);

  // Oldest → newest so the conversation reads top-to-bottom like a chat.
  const thread = [...comments].reverse();

  useEffect(() => {
    if (open && threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [open, comments.length]);

  const entityChoices = entityType === 'task' ? options.tasks : entityType === 'project' ? options.projects : [];

  const send = () => start(async () => {
    setFailure(null);
    const res = await saveComment({ body, entityType, entityId: entityType === 'general' ? null : entityId });
    if ('error' in res) { setFailure(res.error); return; }
    setBody('');
    router.refresh();
  });

  const reinterpret = (id: string, intent: string) => start(async () => {
    const res = await correctCommentIntent(id, intent);
    if (!('error' in res)) router.refresh();
  });

  return (
    <>
      {/* Collapsed launcher — always visible, bottom-end. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={labels.open}
          className="fixed bottom-4 end-4 z-40 flex min-h-12 items-center gap-2 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white shadow-card hover:opacity-90"
        >
          <span aria-hidden="true">💬</span>
          <span className="hidden sm:inline">{labels.title}</span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label={labels.title}
          className="fixed bottom-4 end-4 z-40 flex max-h-[72dvh] w-[calc(100vw-2rem)] flex-col rounded-2xl border border-line bg-card shadow-card motion-safe:animate-sk-rise sm:w-[380px]"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div>
              <p className="text-sm font-semibold text-ink">{labels.title}</p>
              <p className="text-[10px] text-ink3">{labels.subtitle}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label={labels.close}
              className="min-h-9 rounded-full px-2 text-ink3 hover:text-ink">✕</button>
          </header>

          {/* Thread */}
          <div ref={threadRef} className="flex-1 overflow-y-auto px-3 py-3">
            {thread.length === 0 ? (
              <p className="mt-6 text-center text-xs text-ink3">{labels.empty}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {thread.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1">
                    {/* Noa's message */}
                    <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-sm bg-sage-soft px-3 py-2 text-sm text-ink">
                      {c.body}
                      {c.entityType !== 'general' && (
                        <span className="mt-1 block text-[10px] text-ink3">{c.entityLabel}</span>
                      )}
                    </div>
                    {/* Assistant reflection — recorded + how it was read, correctable */}
                    <div className="me-auto max-w-[85%] rounded-2xl rounded-es-sm bg-inset px-3 py-2 text-[11px] text-ink2">
                      {labels.ack.replace('{intent}', labels[`intent.${c.intent}`])}
                      <label className="mt-1 flex items-center gap-1">
                        <span className="text-ink3">{labels.readAs}</span>
                        <select
                          value={c.intent}
                          disabled={pending}
                          onChange={(e) => reinterpret(c.id, e.target.value)}
                          className="rounded border border-line bg-card px-1.5 py-0.5 text-[11px] text-ink2"
                        >
                          {INTENTS.map((i) => <option key={i} value={i}>{labels[`intent.${i}`]}</option>)}
                        </select>
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-line p-3">
            <div className="mb-2 flex gap-2">
              <select
                value={entityType}
                onChange={(e) => { setEntityType(e.target.value as 'general' | 'task' | 'project'); setEntityId(''); }}
                className="min-h-9 rounded-lg border border-line bg-card2 px-2 py-1 text-xs text-ink"
              >
                <option value="general">{labels.linkGeneral}</option>
                <option value="task">{labels.linkTask}</option>
                <option value="project">{labels.linkProject}</option>
              </select>
              {entityType !== 'general' && (
                <select
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  className="min-h-9 flex-1 rounded-lg border border-line bg-card2 px-2 py-1 text-xs text-ink"
                >
                  <option value="">{labels.pick}</option>
                  {entityChoices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              )}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
                rows={2}
                placeholder={labels.placeholder}
                className="min-h-11 flex-1 resize-none rounded-lg border border-line bg-card2 px-3 py-2 text-sm text-ink outline-none focus:border-sage"
              />
              <button
                type="button"
                disabled={pending || !body.trim() || (entityType !== 'general' && !entityId)}
                onClick={send}
                className="min-h-11 rounded-full bg-sage px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {labels.send}
              </button>
            </div>
            {failure && <p role="alert" className="mt-1 text-[11px] font-semibold text-coral">{failure}</p>}
            <p className="mt-1.5 text-[10px] leading-snug text-ink3">{labels.noActions}</p>
          </div>
        </section>
      )}
    </>
  );
}
