import type { APIRoute } from 'astro';
import { sendRegistrationConfirmationEmail } from '../../lib/email';
import { getDatabasePool } from '../../lib/db';

type CallbackItem = {
  Name: string;
  Value: string | number;
};

const readValue = (items: CallbackItem[], key: string): string | number | undefined =>
  items.find((item) => item.Name === key)?.Value;

export const POST: APIRoute = async ({ request }) => {
  const payload = await request.json();
  const stkCallback = payload?.Body?.stkCallback;

  if (!stkCallback) {
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const resultCode = Number(stkCallback.ResultCode);
  const checkoutRequestId = stkCallback.CheckoutRequestID;
  const pool = getDatabasePool();

  const attemptResult = await pool.query<{ registration_id: number; email: string; full_name: string; email_verified_at: Date | null }>(
    `SELECT pa.registration_id, r.email, r.full_name, r.email_verified_at
     FROM payment_attempts pa
     JOIN registrations r ON r.id = pa.registration_id
     WHERE pa.checkout_request_id = $1
     LIMIT 1`,
    [checkoutRequestId]
  );
  const attempt = attemptResult.rows[0];
  const registrationId = attempt?.registration_id;

  if (!registrationId) {
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (resultCode === 0) {
    const callbackItems = (stkCallback.CallbackMetadata?.Item || []) as CallbackItem[];
    const transaction = {
      MpesaReceiptNumber: readValue(callbackItems, 'MpesaReceiptNumber'),
      Amount: readValue(callbackItems, 'Amount'),
      PhoneNumber: readValue(callbackItems, 'PhoneNumber'),
      TransactionDate: readValue(callbackItems, 'TransactionDate')
    };

    await pool.query(
      `UPDATE payment_attempts
       SET status = 'paid', result_code = $1, mpesa_receipt_number = $2, updated_at = NOW()
       WHERE checkout_request_id = $3`,
      [resultCode, transaction.MpesaReceiptNumber, checkoutRequestId]
    );
    await pool.query(
      `UPDATE registrations
       SET payment_status = 'paid',
           mpesa_receipt_number = $1,
           updated_at = NOW()
         WHERE id = $2`,
      [transaction.MpesaReceiptNumber, registrationId]
    );
    if (attempt.email_verified_at) {
      try {
        await sendRegistrationConfirmationEmail(attempt.email, attempt.full_name);
      } catch (error) {
        console.error('Registration confirmation email failed:', error);
      }
    }
    console.log('M-PESA STK callback success:', transaction);
  } else {
    await pool.query(
      `UPDATE payment_attempts
       SET status = 'failed', result_code = $1, result_description = $2, updated_at = NOW()
       WHERE checkout_request_id = $3`,
      [resultCode, stkCallback.ResultDesc, checkoutRequestId]
    );
    await pool.query(
      `UPDATE registrations
       SET payment_status = 'failed', updated_at = NOW()
        WHERE id = $1`,
      [registrationId]
    );
    console.log('M-PESA STK callback result:', {
      ResultCode: resultCode,
      ResultDesc: stkCallback.ResultDesc
    });
  }

  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
