'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { randomBytes } from 'node:crypto';

async function assertUser() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  return user;
}

export interface AppUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function listUsers(): Promise<AppUser[]> {
  await assertUser();
  const admin = supabaseAdmin();
  const { data } = await admin.auth.admin.listUsers({ perPage: 100 });
  return (data?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? '',
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
  }));
}

// Creates a user with a generated temp password, returned ONCE for handoff.
export async function createAppUser(formData: FormData): Promise<{ error?: string; email?: string; password?: string }> {
  await assertUser();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'invalid email' };
  const password = 'Sk-' + randomBytes(9).toString('base64url');
  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return { error: error.message };
  revalidatePath('/settings');
  return { email, password };
}

export async function deleteAppUser(userId: string): Promise<{ error?: string }> {
  const me = await assertUser();
  if (me.id === userId) return { error: 'cannot delete yourself' };
  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };
  revalidatePath('/settings');
  return {};
}
