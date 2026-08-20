'use client';

import { useTransition } from 'react';
import { saveStageOverride } from '@/app/actions/settings';

export interface OverrideProject {
  id: string;
  name: string;
  stages: { stage_key: string; label: string; status: string; substage: string | null }[];
}

interface Labels { currentStage: string; substage: string; save: string }

export function OverrideForm({ project, labels }: { project: OverrideProject; labels: Labels }) {
  const [pending, start] = useTransition();
  const current = project.stages.find((s) => s.status === 'current');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(fd) => start(async () => { await saveStageOverride(fd); })}
    >
      <input type="hidden" name="project_id" value={project.id} />
      <p className="w-40 truncate text-sm font-medium text-ink">{project.name}</p>
      <label className="text-xs text-ink2">
        {labels.currentStage}
        <select name="stage_key" defaultValue={current?.stage_key}
          className="ms-1 rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink">
          {project.stages.map((s) => <option key={s.stage_key} value={s.stage_key}>{s.label}</option>)}
        </select>
      </label>
      <label className="text-xs text-ink2">
        {labels.substage}
        <input name="substage" defaultValue={current?.substage ?? ''}
          className="ms-1 w-40 rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink" />
      </label>
      <button type="submit" disabled={pending}
        className="rounded-lg border border-sage-line bg-sage-soft px-3 py-1 text-xs text-sage disabled:opacity-60">
        {labels.save}
      </button>
    </form>
  );
}
