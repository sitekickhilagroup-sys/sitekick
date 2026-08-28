'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { resolvePresetKey } from '@/lib/avatar-presets';

type ActionResult = { ok: true } | { error: string };

const NAME_MAX = 60;

async function logProfileAction(
  userId: string,
  email: string | null,
  action: string,
  after: Record<string, unknown> | null,
) {
  // Never put credentials in the log — password_change records the event only.
  await supabaseAdmin().from('activity_log').insert({
    entity_type: 'profile',
    entity_id: userId,
    actor: email ?? userId,
    action,
    after_json: after,
  });
}

/** Display name (what the AI calls you) + preset avatar choice. */
export async function saveProfile(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const displayName = String(formData.get('display_name') ?? '').trim().slice(0, NAME_MAX);
  const preset = String(formData.get('avatar_preset') ?? '');

  const patch: Record<string, unknown> = {
    user_id: user.id,
    display_name: displayName || null,
    updated_at: new Date().toISOString(),
  };
  // Empty preset = keep the current avatar (photo uploads come through
  // uploadAvatar); a named preset must be one we actually ship.
  if (preset) {
    const key = resolvePresetKey(preset);
    if (!key) return { error: 'invalid_preset' };
    patch.avatar = `preset:${key}`;
  }

  const { error } = await supabaseAdmin().from('profiles').upsert(patch, { onConflict: 'user_id' });
  if (error) return { error: error.message };

  await logProfileAction(user.id, user.email, 'profile_update', {
    display_name: patch.display_name,
    ...(patch.avatar ? { avatar: patch.avatar } : {}),
  });
  revalidatePath('/', 'layout'); // avatar + name render in the global header
  return { ok: true };
}

const AVATAR_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export async function uploadAvatar(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'no_file' };
  if (file.size > AVATAR_MAX_BYTES) return { error: 'too_large' };
  const ext = AVATAR_TYPES[file.type];
  if (!ext) return { error: 'bad_type' };

  const admin = supabaseAdmin();
  const path = `${user.id}/avatar.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from('avatars').upload(path, buffer, {
    contentType: file.type,
    upsert: true,
  });
  if (upErr) return { error: upErr.message };

  // Cache-bust: the path is stable across re-uploads, the query string isn't.
  const { data: pub } = admin.storage.from('avatars').getPublicUrl(path);
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error } = await admin.from('profiles').upsert(
    { user_id: user.id, avatar: url, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) return { error: error.message };

  await logProfileAction(user.id, user.email, 'avatar_upload', { avatar: url });
  revalidatePath('/', 'layout');
  return { ok: true };
}

const PASSWORD_MIN = 8;

export async function changePassword(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.email) return { error: 'no_email' };
  const current = String(formData.get('current_password') ?? '');
  const next = String(formData.get('new_password') ?? '');
  const confirm = String(formData.get('confirm_password') ?? '');

  if (next.length < PASSWORD_MIN) return { error: 'pw_short' };
  if (next !== confirm) return { error: 'pw_mismatch' };

  // Re-authenticate before changing: a stolen open session must not be able
  // to silently take over the account. Throwaway anon client, no session kept.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: verifyErr } = await anon.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyErr) return { error: 'pw_wrong' };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: error.message };

  await logProfileAction(user.id, user.email, 'password_change', null);
  return { ok: true };
}
