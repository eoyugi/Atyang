import type { APIRoute } from 'astro';

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

  if (resultCode === 0) {
    const callbackItems = (stkCallback.CallbackMetadata?.Item || []) as CallbackItem[];
    const transaction = {
      MpesaReceiptNumber: readValue(callbackItems, 'MpesaReceiptNumber'),
      Amount: readValue(callbackItems, 'Amount'),
      PhoneNumber: readValue(callbackItems, 'PhoneNumber'),
      TransactionDate: readValue(callbackItems, 'TransactionDate')
    };

    console.log('M-PESA STK callback success:', transaction);
  } else {
    console.log('M-PESA STK callback result:', {
      ResultCode: resultCode,
      ResultDesc: stkCallback.ResultDesc
    });
  }

  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
