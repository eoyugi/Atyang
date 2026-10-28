import type { APIRoute } from 'astro';

const OAUTH_URL = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
const STK_PUSH_URL = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

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
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ];

  return parts.join('');
};

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

  const data = await response.json();
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
      return new Response(JSON.stringify({ error: 'Name, email, and phone are required.' }), { status: 400 });
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    const ticketAmount = Number(amount ?? 500);

    if (!Number.isFinite(ticketAmount) || ticketAmount <= 0) {
      return new Response(JSON.stringify({ error: 'Amount must be a valid positive number.' }), { status: 400 });
    }

    const shortcode = import.meta.env.MPESA_SHORTCODE || '174379';
    const passkey = import.meta.env.MPESA_PASSKEY;
    const callbackUrl = import.meta.env.MPESA_CALLBACK_URL;

    if (!passkey || !callbackUrl) {
      return new Response(JSON.stringify({ error: 'Missing M-PESA shortcode, passkey, or callback URL.' }), {
        status: 500
      });
    }

    const timestamp = getTimestamp();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    const accessToken = await getMpesaAccessToken();
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

    const result = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: result?.errorMessage || 'STK push request failed.' }), {
        status: response.status
      });
    }

    return new Response(
      JSON.stringify({
        CheckoutRequestID: result.CheckoutRequestID,
        ResponseCode: result.ResponseCode,
        CustomerMessage: result.CustomerMessage
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
