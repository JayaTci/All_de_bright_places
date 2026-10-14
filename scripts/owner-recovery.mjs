// Generates a private recovery link and optionally removes lost TOTP factors for one approved editor.
import { ownerRequest, privateOutput } from './owner-client.mjs';
const username = process.argv[2];
if (!['ruby', 'jayatci'].includes(username)) throw new Error('Choose ruby or jayatci.');
const redirect = process.env.OWNER_RECOVERY_REDIRECT;
if (!redirect) throw new Error('Set OWNER_RECOVERY_REDIRECT to the approved /auth/recovery URL.');
const recoveryUrl = new URL(redirect);
const localHttp = recoveryUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(recoveryUrl.hostname);
if (recoveryUrl.pathname !== '/auth/recovery' || recoveryUrl.search || recoveryUrl.hash || !(recoveryUrl.protocol === 'https:' || localHttp)) {
  throw new Error('OWNER_RECOVERY_REDIRECT must be the exact approved /auth/recovery URL.');
}
const [account] = await ownerRequest(`/rest/v1/editor_accounts?username=eq.${username}&select=user_id`);
if (!account) throw new Error('Provision the editor first.');
const result = await ownerRequest(`/auth/v1/admin/users/${account.user_id}`);
const user = result.user ?? result;
const link = await ownerRequest('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'recovery', email: user.email, redirect_to: redirect }) });
const tokenHash = link.hashed_token ?? link.properties?.hashed_token;
if (!tokenHash) throw new Error('Recovery response did not contain a token hash.');
recoveryUrl.searchParams.set('token_hash', tokenHash);
recoveryUrl.searchParams.set('type', 'recovery');
const output = await privateOutput(`recovery-${username}-${Date.now()}.txt`, recoveryUrl.toString());
if (process.argv.includes('--reset-mfa')) {
  const factors = await ownerRequest(`/auth/v1/admin/users/${account.user_id}/factors`);
  for (const factor of factors ?? []) {
    if (factor.factor_type === 'totp') await ownerRequest(`/auth/v1/admin/users/${account.user_id}/factors/${factor.id}`, { method: 'DELETE' });
  }
}
console.log(`Recovery output saved privately to ${output}`);
