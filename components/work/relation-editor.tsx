'use client';

import { useState, useTransition } from 'react';
import { deleteRelationship, saveRelationship } from '@/app/actions/relationships';
import type { Relationship, RelationshipType } from '@/lib/types';

export interface RelationRow {
  rel: Relationship;
  otherTitle: string;
  direction: 'from' | 'to';
}

const TYPES: RelationshipType[] = ['blocks', 'supports', 'parallel', 'unrelated', 'needs_verification'];

interface Props {
  taskId: string;
  relations: RelationRow[];
  taskOptions: { id: string; title: string }[];
  labels: Record<string, string>;
}

// Existing relations as removable chips + a compact add-form (Sprint C task 4).
// "blocks_this"/"blocked_by_this" annotate which way the edge points relative
// to the current task, independent of the relationship type itself.
export function RelationEditor({ taskId, relations, taskOptions, labels }: Props) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [to, setTo] = useState('');
  const [type, setType] = useState<RelationshipType>('blocks');
  const [reason, setReason] = useState('');

  const remove = (id: string) => start(async () => {
    setFailed(false);
    const res = await deleteRelationship(id);
    if (res?.error) setFailed(true);
  });

  const add = () => {
    if (!to) { setFailed(true); return; }
    start(async () => {
      setFailed(false);
      const res = await saveRelationship(taskId, to, type, reason);
      if (res?.error) { setFailed(true); return; }
      setTo('');
      setType('blocks');
      setReason('');
    });
  };

  return (
    <div className="mt-2 space-y-2 border-t border-line2 pt-2">
      <p className="text-[11px] font-medium text-ink2">{labels.title}</p>

      {relations.length === 0 && labels.relEmpty && (
        <p className="text-[11px] text-ink3">{labels.relEmpty}</p>
      )}
      {relations.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {relations.map(({ rel, otherTitle, direction }) => (
            <li
              key={rel.id}
              className={`inline-flex items-center gap-1 rounded-full border ps-2.5 pe-1 py-1 text-[11px] ${
                rel.type === 'blocks' ? 'border-coral/30 bg-coral-soft text-coral' : 'border-line bg-card2 text-ink2'
              }`}
            >
              <span>
                {labels['rel.type.' + rel.type]} · {otherTitle}
                {rel.type === 'blocks' && (
                  <span className="opacity-70"> ({direction === 'from' ? labels['rel.blocks_this'] : labels['rel.blocked_by_this']})</span>
                )}
              </span>
              <button
                type="button"
                disabled={pending}
                aria-label={labels.remove}
                onClick={() => remove(rel.id)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full opacity-60 hover:opacity-100 disabled:opacity-40 sm:min-h-6 sm:min-w-6"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label={labels.pickTask ?? labels.add}
          className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9"
        >
          <option value="">—</option>
          {taskOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.title}</option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as RelationshipType)}
          aria-label={labels.title}
          className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9"
        >
          {TYPES.map((tp) => (
            <option key={tp} value={tp}>{labels['rel.type.' + tp]}</option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={labels.reason}
          aria-label={labels.reason}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9"
        />
        <button
          type="button"
          disabled={pending || !to}
          onClick={add}
          className="min-h-11 w-full rounded-lg bg-sage px-3 py-1.5 text-sm text-white disabled:opacity-50 sm:min-h-9 sm:w-auto"
        >
          {labels.add}
        </button>
      </div>

      {failed && <p role="alert" className="text-[11px] text-coral">{labels.error}</p>}
    </div>
  );
}
