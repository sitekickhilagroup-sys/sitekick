'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Dropzone, type DropzoneLabels } from '@/app/(dash)/(focused)/upload/dropzone';
import { PasteUpdate } from './paste-update';

/**
 * One intake surface at a time (spec §8-§12).
 *
 * Before this, the five "source" cards were static <article>s with no state
 * and no click handler — decoration — while the drop zone and the full Paste
 * Update form were both permanently visible, which §9 explicitly forbids.
 *
 * Every `accept` string below matches a real branch in app/api/upload/route.ts.
 * The spec's own example lists MBOX and MSG; this API has no branch for either,
 * so they are not offered. MP4 is stored and linked only — transcription is not
 * implemented — so its copy must not imply otherwise.
 */
export type IntakeChannel = 'email' | 'meeting' | 'document' | 'sheet' | 'text';

export interface IntakeTab {
  id: IntakeChannel;
  label: string;
  formats: string;
  accept: string;
}

interface Props {
  tabs: IntakeTab[];
  projects: string[];
  dropLabels: DropzoneLabels;
  pasteLabels: Record<string, string>;
  sheetInfo: string;
  sheetSettings: string;
  pasteInstead: string;
  pasteTab: string;
}

export function IntakePanel({
  tabs, projects, dropLabels, pasteLabels, sheetInfo, sheetSettings, pasteInstead, pasteTab,
}: Props) {
  const [channel, setChannel] = useState<IntakeChannel>('email');
  // Lives here, not inside Dropzone: the Sheet and Paste tabs render a
  // different component at this same slot, which unmounts Dropzone and would
  // otherwise reset the chosen project when the user comes back to a file tab.
  const [project, setProject] = useState('');
  const current = tabs.find((tb) => tb.id === channel) ?? tabs[0];

  return (
    <div className="rounded-[15px] border border-line bg-sk-surface p-4 shadow-card sm:p-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tabs.map((tb) => {
          const on = tb.id === channel;
          return (
            <button
              key={tb.id}
              type="button"
              aria-pressed={on}
              onClick={() => setChannel(tb.id)}
              className={`min-h-11 cursor-pointer rounded-[12px] border px-3 py-3 text-start transition-colors ${
                on
                  ? 'border-sage-line bg-sk-green-soft shadow-[0_0_0_2px_var(--color-sage-soft)]'
                  : 'border-line bg-sk-surface-soft hover:border-line2'
              }`}
            >
              <span className={`block text-[11px] font-[650] ${on ? 'text-sk-green' : 'text-sk-ink'}`}>{tb.label}</span>
              <span className="mt-0.5 block font-mono text-[9px] leading-[1.35] text-sk-muted">{tb.formats}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {channel === 'sheet' ? (
          // No user-facing Sheet endpoint exists: sync is a cron job reading
          // sheet IDs from settings. Offering a URL box here would post nowhere.
          <div className="rounded-[12px] border border-dashed border-sk-line-strong bg-sk-upload-surface px-5 py-8 text-center">
            <p className="mx-auto max-w-md text-[11px] leading-[1.6] text-sk-text">{sheetInfo}</p>
            <Link
              href="/settings"
              className="mt-3 inline-flex min-h-11 items-center rounded-[8px] border border-sage-line px-4 py-2 text-[10px] font-[650] leading-none text-sk-green hover:bg-sk-green-soft sm:min-h-0"
            >
              {sheetSettings}
            </Link>
          </div>
        ) : channel === 'text' ? (
          <PasteUpdate labels={pasteLabels} />
        ) : (
          <Dropzone
            projects={projects}
            accept={current.accept}
            title={current.label}
            formats={current.formats}
            labels={dropLabels}
            project={project}
            onProjectChange={setProject}
          />
        )}
      </div>

      {channel !== 'text' ? (
        <button
          type="button"
          onClick={() => setChannel('text')}
          className="mt-3 min-h-11 cursor-pointer text-[10px] font-[650] text-sk-green hover:underline sm:min-h-0"
        >
          {pasteInstead} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setChannel('email')}
          className="mt-3 min-h-11 cursor-pointer text-[10px] font-[650] text-sk-muted hover:text-sk-ink sm:min-h-0"
        >
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">←</span> {pasteTab}
        </button>
      )}
    </div>
  );
}
