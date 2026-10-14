// Generates a private recovery link and optionally removes lost TOTP factors for one approved editor.
import { ownerRequest, privateOutput } from './owner-client.mjs';
const username = process.argv[2];
if (!['ruby', 'jayatci'].includes(username)) throw new Error('Choose ruby or jayatci.');
const redirect = process.env.OWNER_RECOVERY_REDIRECT;
if (!redirect) throw new Error('Set OWNER_RECOVERY_REDIRECT to the approved /auth/recovery URL.');
const [account] = await ownerRequest(`/rest/v1/editor_accounts?username=eq.${username}&select=user_id`);
if (!account) throw new Error('Provision the editor first.');
const result = await ownerRequest(`/auth/v1/admin/users/${account.user_id}`);
const user = result.user ?? result;
if (process.argv.includes('--reset-mfa')) {
  const factors = await ownerRequest(`/auth/v1/admin/users/${account.user_id}/factors`);
  for (const factor of factors ?? []) {
    if (factor.factor_type === 'totp') await ownerRequest(`/auth/v1/admin/users/${account.user_id}/factors/${factor.id}`, { method: 'DELETE' });
  }
}
const link = await ownerRequest('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'recovery', email: user.email, redirect_to: redirect }) });
const actionLink = link.action_link ?? link.properties?.action_link;
if (!actionLink) throw new Error('Recovery response did not contain a link.');
console.log(`Recovery output saved privately to ${await privateOutput(`recovery-${username}-${Date.now()}.txt`, actionLink)}`);
