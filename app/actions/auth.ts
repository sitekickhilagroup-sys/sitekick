'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export async function signIn(formData: FormData): Promise<{ error: string } | never> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect('/');
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}
