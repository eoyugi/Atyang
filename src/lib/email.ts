import { createHash, randomBytes } from 'node:crypto';

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const createToken = (): { token: string; tokenHash: string } => {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
};

export const hashTokenValue = (token: string): string => hashToken(token);

export const sendVerificationEmail = async (email: string, name: string, token: string): Promise<void> => {
  const apiKey = import.meta.env.RESEND_API_KEY;
  const from = import.meta.env.EMAIL_FROM;
  const siteUrl = import.meta.env.PUBLIC_SITE_URL;

  if (!apiKey || !from || !siteUrl) {
    throw new Error('Email is not configured. Set RESEND_API_KEY, EMAIL_FROM, and PUBLIC_SITE_URL.');
  }

  const verificationUrl = new URL('/api/verify-email', siteUrl);
  verificationUrl.searchParams.set('token', token);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Verify your Atyang event registration',
      text: `Hi ${name},\n\nVerify your email address to continue your Atyang event registration:\n${verificationUrl}\n\nThis link expires in 15 minutes and can only be used once.`
    })
  });

  if (!response.ok) {
    throw new Error('Unable to send the verification email. Please try again.');
  }
};

export const sendRegistrationConfirmationEmail = async (email: string, name: string): Promise<void> => {
  const apiKey = import.meta.env.RESEND_API_KEY;
  const from = import.meta.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new Error('Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Your Atyang event registration is confirmed',
      text: `Hi ${name},\n\nYour payment was received and your email address is verified. Your event ticket or access instructions will be provided by the event organizer.`
    })
  });

  if (!response.ok) {
    throw new Error('Unable to send the registration confirmation email.');
  }
};