'use client';

import { useTransition } from 'react';
import { saveSheetIds } from '@/app/actions/settings';

interface Sheets { gantt?: { id: string; range: string }; budget?: { id: string; range: string } }

export function SheetsForm({ value, saveLabel }: { value: Sheets; saveLabel: string }) {
  const [pending, start] = useTransition();
  const field = (name: string, def: string, placeholder: string) => (
    <input name={name} defaultValue={def} placeholder={placeholder}
      className="w-full rounded-lg border border-line bg-card2 px-2 py-1.5 font-mono text-xs text-ink" />
  );
  return (
    <form className="grid gap-2 sm:grid-cols-2" action={(fd) => start(async () => { await saveSheetIds(fd); })}>
      {field('gantt_id', value.gantt?.id ?? '', 'Gantt sheet ID')}
      {field('gantt_range', value.gantt?.range ?? 'A1:E200', 'Gantt range')}
      {field('budget_id', value.budget?.id ?? '', 'Budget sheet ID')}
      {field('budget_range', value.budget?.range ?? 'A1:F300', 'Budget range')}
      <button type="submit" disabled={pending}
        className="w-fit rounded-lg bg-sage px-4 py-1.5 text-sm text-white disabled:opacity-60">
        {saveLabel}
      </button>
    </form>
  );
}
