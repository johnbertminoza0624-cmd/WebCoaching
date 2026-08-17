import { redirect } from 'next/navigation';

/** `/settings` has no content of its own yet — change-password is the only
 * item in it, so the bare path lands there rather than on an empty shell. */
export default function SettingsIndex() {
  redirect('/settings/password');
}
