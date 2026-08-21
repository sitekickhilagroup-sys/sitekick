import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { Dropzone } from './dropzone';
import type { Project } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const { data } = await supabase.from('projects').select('id,name').order('name');
  const projects = (data ?? []) as Pick<Project, 'id' | 'name'>[];

  return (
    <div className="space-y-4 pb-16">
      <h1 className="font-serif text-2xl text-ink sm:text-3xl">{t('upload.title')}</h1>
      <p className="text-sm text-ink3">{t('upload.help')}</p>
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
    </div>
  );
}
