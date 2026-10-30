import type { APIRoute } from 'astro';
import { createToken, hashTokenValue, sendVerificationEmail } from '../../lib/email';
import { getDatabasePool } from '../../lib/db';

const OAUTH_URL = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
const STK_PUSH_URL = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

const jsonResponse = (body: Record<string, unknown>, status = 200, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });

const readJson = async (response: Response): Promise<Record<string, any>> => {
  const body = await response.text();

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body) as Record<string, any>;
  } catch {
    return { errorMessage: body.slice(0, 300) };
  }
};

const normalizePhoneNumber = (rawPhone: string): string => {
  const digits = rawPhone.replace(/\D/g, '');

  if (/^0[17]\d{8}$/.test(digits)) {
    return `254${digits.slice(1)}`;
  }

  if (/^254[17]\d{8}$/.test(digits)) {
    return digits;
  }

  throw new Error('Invalid phone number. Use 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, or 2541XXXXXXXX.');
};

const getTimestamp = (): string => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
};

const getCookieValue = (cookieHeader: string | null, name: string): string | undefined =>
  cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const getMpesaAccessToken = async (): Promise<string> => {
  const consumerKey = import.meta.env.MPESA_CONSUMER_KEY;
  const consumerSecret = import.meta.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('Missing M-PESA consumer credentials.');
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const response = await fetch(OAUTH_URL, {
    headers: {
      Authorization: `Basic ${auth}`
    }
  });

  const data = await readJson(response);
  if (!response.ok || !data.access_token) {
    throw new Error('Failed to fetch M-PESA access token.');
  }

  return data.access_token;
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { name, email, phone, amount } = (await request.json()) as {
      name?: string;
      email?: string;
      phone?: string;
      amount?: number;
    };

    if (!name || !email || !phone) {
      return jsonResponse({ error: 'Name, email, and phone are required.' }, 400);
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    const ticketAmount = Number(amount ?? 500);

    if (!Number.isFinite(ticketAmount) || ticketAmount <= 0) {
      return jsonResponse({ error: 'Amount must be a valid positive number.' }, 400);
    }

    const shortcode = import.meta.env.MPESA_SHORTCODE || '174379';
    const passkey = import.meta.env.MPESA_PASSKEY;
    const callbackUrl = import.meta.env.MPESA_CALLBACK_URL;

    if (!passkey || !callbackUrl) {
      return jsonResponse(
        { error: 'M-PESA is not configured. Set MPESA_PASSKEY and MPESA_CALLBACK_URL in .env.' },
        503
      );
    }

    try {
      new URL(callbackUrl);
    } catch {
      return jsonResponse({ error: 'MPESA_CALLBACK_URL must be a valid public URL.' }, 503);
    }

    const pool = getDatabasePool();
    const sessionToken = getCookieValue(request.headers.get('cookie'), 'registration_session');
    let activeRegistrationId: number | undefined;

    if (sessionToken) {
      const sessionResult = await pool.query<{ id: number; payment_status: string; email_verified_at: Date | null }>(
        `SELECT id, payment_status, email_verified_at
         FROM registrations
         WHERE registration_session_hash = $1
         LIMIT 1`,
        [hashTokenValue(sessionToken)]
      );
      const sessionRegistration = sessionResult.rows[0];

      if (sessionRegistration) {
        activeRegistrationId = sessionRegistration.id;

        if (sessionRegistration.payment_status === 'paid') {
          return jsonResponse({ error: 'This registration has already been paid for.' }, 409);
        }

        if (!sessionRegistration.email_verified_at) {
          return jsonResponse({
            error: 'Check your email and click the verification link before starting payment.',
            emailVerificationRequired: true
          }, 202, {
            'Set-Cookie': `registration_session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
          });
        }
      }
    }

    if (activeRegistrationId) {
      const existingRegistration = await pool.query<{ payment_status: string }>(
        `SELECT payment_status
         FROM registrations
         WHERE id = $1
         LIMIT 1`,
        [activeRegistrationId]
      );

      if (!existingRegistration.rows[0]) {
        return jsonResponse({ error: 'Registration not found. Please submit the form again.' }, 404);
      }

      if (existingRegistration.rows[0].payment_status === 'paid') {
        return jsonResponse({ error: 'This registration has already been paid for.' }, 409);
      }
    } else {
      const session = createToken();
      try {
        const registrationResult = await pool.query<{ id: number }>(
          `INSERT INTO registrations (full_name, email, phone, amount, payment_status, registration_session_hash)
           VALUES ($1, $2, $3, $4, 'pending', $5)
           RETURNING id`,
          [name.trim(), email.trim().toLowerCase(), normalizedPhone, Math.round(ticketAmount), session.tokenHash]
        );
        activeRegistrationId = registrationResult.rows[0]?.id;

        const verification = createToken();
        await pool.query(
          `UPDATE registrations
           SET email_verification_token_hash = $1,
               email_verification_expires_at = NOW() + INTERVAL '15 minutes'
           WHERE id = $2`,
          [verification.tokenHash, activeRegistrationId]
        );
        await sendVerificationEmail(email.trim().toLowerCase(), name.trim(), verification.token);

        return jsonResponse({
          emailVerificationRequired: true,
          message: 'Verification email sent. Click the link in your email, then submit the form again to pay.'
        }, 202, {
          'Set-Cookie': `registration_session=${session.token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
          const existingRegistration = await pool.query<{ id: number; payment_status: string }>(
            `SELECT id, payment_status
             FROM registrations
             WHERE phone = $1
             LIMIT 1`,
            [normalizedPhone]
          );
          const existing = existingRegistration.rows[0];

          if (!existing) {
            throw error;
          }

          if (existing.payment_status === 'paid') {
            return jsonResponse({ error: 'This phone number is already registered and paid.' }, 409);
          }

          if (existing.payment_status === 'pending') {
            return jsonResponse({ error: 'A registration already exists for this phone number. Use the original verification email.' }, 409);
          }

          activeRegistrationId = existing.id;
        } else {
          throw error;
        }
      }
    }

    if (!activeRegistrationId) {
      throw new Error('Could not create the registration record.');
    }

    const timestamp = getTimestamp();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    const accessToken = await getMpesaAccessToken();

    const attemptResult = await pool.query<{ id: number }>(
      `INSERT INTO payment_attempts (registration_id, payer_phone, amount)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [activeRegistrationId, normalizedPhone, Math.round(ticketAmount)]
    );
    const attemptId = attemptResult.rows[0]?.id;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    headers.Authorization = ['Bearer', accessToken].join(' ');

    const response = await fetch(STK_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(ticketAmount),
        PartyA: normalizedPhone,
        PartyB: shortcode,
        PhoneNumber: normalizedPhone,
        CallBackURL: callbackUrl,
        AccountReference: 'Atyang Gig',
        TransactionDesc: `Ticket registration for ${name}`
      })
    });

    const result = await readJson(response);
    if (!response.ok) {
      await pool.query(
        `UPDATE payment_attempts
         SET status = 'failed', result_description = $1, updated_at = NOW()
         WHERE id = $2`,
        [result.errorMessage || 'STK push request failed.', attemptId]
      );
      await pool.query(
        `UPDATE registrations
         SET payment_status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [activeRegistrationId]
      );
      return jsonResponse({
        error: result.errorMessage || 'STK push request failed.',
        registrationId: activeRegistrationId
      }, response.status);
    }

    if (result.ResponseCode !== '0' && result.ResponseCode !== 0) {
      const message = result.CustomerMessage || 'M-PESA did not accept the payment request.';
      await pool.query(
        `UPDATE payment_attempts
         SET status = 'failed', result_code = $1, result_description = $2, updated_at = NOW()
         WHERE id = $3`,
        [Number(result.ResponseCode), message, attemptId]
      );
      await pool.query(
        `UPDATE registrations SET payment_status = 'failed', updated_at = NOW() WHERE id = $1`,
        [activeRegistrationId]
      );
      return jsonResponse({ error: message, registrationId: activeRegistrationId }, 502);
    }

    await pool.query(
      `UPDATE payment_attempts
       SET checkout_request_id = $1, status = 'pending', updated_at = NOW()
       WHERE id = $2`,
      [result.CheckoutRequestID, attemptId]
    );
    await pool.query(
      `UPDATE registrations
       SET mpesa_checkout_request_id = $1, payment_status = 'pending', updated_at = NOW()
       WHERE id = $2`,
      [result.CheckoutRequestID, activeRegistrationId]
    );

    return jsonResponse({
      registrationId: activeRegistrationId,
      CheckoutRequestID: result.CheckoutRequestID,
      ResponseCode: result.ResponseCode,
      CustomerMessage: result.CustomerMessage
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return jsonResponse({ error: message }, 500);
  }
};
