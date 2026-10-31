import type { APIRoute } from 'astro';
import { hashTokenValue } from '../../lib/email';
import { getDatabasePool } from '../../lib/db';

export const GET: APIRoute = async ({ redirect, url }) => {
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Verification token is required.', { status: 400 });
  }

  const result = await getDatabasePool().query<{ id: number }>(
    `UPDATE registrations
     SET email_verified_at = NOW(),
         email_verification_token_hash = NULL,
         email_verification_expires_at = NULL,
         updated_at = NOW()
     WHERE email_verification_token_hash = $1
       AND email_verification_expires_at > NOW()
       AND email_verified_at IS NULL
     RETURNING id`,
    [hashTokenValue(token)]
  );

  if (!result.rows[0]) {
    return new Response('This verification link is invalid, expired, or has already been used.', { status: 400 });
  }

  return redirect('/?verified=1', 303);
};