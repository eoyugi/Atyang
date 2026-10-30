import type { APIRoute } from 'astro';
import { getDatabasePool } from '../../lib/db';

const jsonResponse = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

export const GET: APIRoute = async ({ url }) => {
  const checkoutRequestId = url.searchParams.get('checkoutRequestId');

  if (!checkoutRequestId) {
    return jsonResponse({ error: 'Checkout request ID is required.' }, 400);
  }

  try {
    const result = await getDatabasePool().query<{ status: string; result_description: string | null }>(
      `SELECT status, result_description
       FROM payment_attempts
       WHERE checkout_request_id = $1
       LIMIT 1`,
      [checkoutRequestId]
    );
    const paymentStatus = result.rows[0]?.status;

    if (!paymentStatus) {
      return jsonResponse({ error: 'Payment request not found.' }, 404);
    }

    return jsonResponse({
      status: paymentStatus,
      message: result.rows[0]?.result_description || undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to check payment status.';
    return jsonResponse({ error: message }, 500);
  }
};