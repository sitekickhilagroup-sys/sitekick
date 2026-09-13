'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { randomBytes } from 'node:crypto';

// requireAdmin is exported (and async, so it's a valid Server Action) so
// other admin-only surfaces (e.g. app/actions/llm-usage.ts) reuse the SAME
// gate instead of a second copy — isAdminEmail itself now lives in
// lib/admin.ts (a synchronous export here would fail the build: "Server
// Actions must be async functions").
export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) throw new Error('forbidden');
  return user;
}

export interface AppUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function listUsers(): Promise<AppUser[]> {
  await requireAdmin();
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
  await requireAdmin();
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
  const me = await requireAdmin();
  if (me.id === userId) return { error: 'cannot delete yourself' };
  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };
  revalidatePath('/settings');
  return {};
}
