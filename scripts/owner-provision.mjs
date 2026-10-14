// Provisions only the two approved identities through an owner-held administrative key.
import { randomBytes } from 'node:crypto';
import { ownerRequest, privateOutput } from './owner-client.mjs';
const editors = ['ruby', 'jayatci'];
const existing = await ownerRequest('/rest/v1/editor_accounts?select=user_id,username');
for (const username of editors) {
  if (!existing.some(account => account.username === username) && !process.env[`OWNER_${username.toUpperCase()}_EMAIL`]) {
    throw new Error(`Set OWNER_${username.toUpperCase()}_EMAIL privately before provisioning.`);
  }
}
let created = 0;
for (const username of editors) {
  if (existing.some(account => account.username === username)) continue;
  const email = process.env[`OWNER_${username.toUpperCase()}_EMAIL`];
  if (!email) throw new Error(`Set OWNER_${username.toUpperCase()}_EMAIL privately before provisioning.`);
  const password = randomBytes(24).toString('base64url');
  const user = await ownerRequest('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) });
  const userId = user.id ?? user.user?.id;
  if (!userId) throw new Error('Provisioning did not return an identity. Inspect the Auth dashboard privately.');
  const output = await privateOutput(`provision-${username}-${Date.now()}.json`, JSON.stringify({ username, userId, email, temporaryPassword: password }, null, 2));
  console.log(`Identity credentials saved privately to ${output}.`);
  await ownerRequest('/rest/v1/editor_accounts', { method: 'POST', body: JSON.stringify({ user_id: userId, username }) });
  created += 1;
}
console.log(created ? 'Editor provisioning complete.' : 'Both editor identities are already provisioned.');
