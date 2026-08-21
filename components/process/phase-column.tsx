import type { PhaseView } from '@/lib/process';
import type { SubstageTemplate } from '@/lib/types';
import { SubstageRow } from './substage-row';

interface Props {
  projectId: string;
  view: PhaseView;
  isCurrent: boolean;
  unactivated: SubstageTemplate[];
  labels: Record<string, string>;
}

export function PhaseColumn({ projectId, view, isCurrent, unactivated, labels }: Props) {
  return (
    <div className="rounded-(--radius-card) border border-line bg-card p-3 shadow-card">
      <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${
        isCurrent ? 'bg-sage text-white' : 'bg-card2 text-ink2'
      }`}>
        {view.phase.label}
      </span>

      {view.workstreams.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {view.workstreams.map((w) => (
            <span key={w.id} className="bg-mist-soft text-mist rounded-full px-2 py-0.5 text-[11px]">
              {labels.parallel}: {w.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3">
        {view.substages.length === 0 ? (
          <p className="text-xs text-ink3">{labels.emptyPhase}</p>
        ) : (
          <ul>
            {view.substages.map(({ template, instance }) => (
              <SubstageRow key={template.id} projectId={projectId} template={template} instance={instance} labels={labels} />
            ))}
          </ul>
        )}
      </div>

      {unactivated.length > 0 && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-1 text-xs text-ink2 hover:text-ink sm:min-h-0">{labels.activate}</summary>
          <ul className="mt-1">
            {unactivated.map((template) => (
              <SubstageRow key={template.id} projectId={projectId} template={template} instance={null} labels={labels} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
