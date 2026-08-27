import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { orderProjectsByRtiProgress } from '@/lib/project-order';
import type { Phase, Project, ProjectSubstage, SubstageTemplate } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Nav's "Project process" tab (spec §א) — the process view is per-project.
// Q12 (Noa): the index lands on the MOST-ADVANCED project (closest to RTI),
// not the first by name; the switcher pills on that page take it from there.
export default async function ProjectsIndexPage() {
  const supabase = await supabaseServer();
  const [projectsQ, phasesQ, templatesQ, instancesQ] = await Promise.all([
    supabase.from('projects').select('id,name,current_phase_key,business_rank,active'),
    supabase.from('phases').select('key,position'),
    supabase.from('substage_templates').select('*'),
    supabase.from('project_substages').select('*'),
  ]);
  const active = ((projectsQ.data ?? []) as (Pick<Project, 'id' | 'name' | 'current_phase_key' | 'business_rank'> & { active: boolean | null })[])
    .filter((p) => p.active !== false);
  const ordered = orderProjectsByRtiProgress(
    active,
    (phasesQ.data ?? []) as Pick<Phase, 'key' | 'position'>[],
    (templatesQ.data ?? []) as SubstageTemplate[],
    (instancesQ.data ?? []) as ProjectSubstage[],
  );
  if (ordered[0]) redirect(`/projects/${ordered[0].id}`);
  redirect('/');
}
