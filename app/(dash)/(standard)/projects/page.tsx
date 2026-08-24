import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Nav's "Project process" tab (spec §א) — the process view is per-project,
// so the index lands on the first project by name; the switcher pills on
// that page take it from there.
export default async function ProjectsIndexPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('projects')
    .select('id')
    .order('name')
    .limit(1)
    .maybeSingle();
  if (data) redirect(`/projects/${data.id}`);
  redirect('/');
}
