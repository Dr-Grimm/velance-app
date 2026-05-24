# Velance SMTP Setup

Velance uses Supabase Auth for email OTP sign-in. Public releases must use custom SMTP instead of the default Supabase mailer.

## Provider

Use Brevo transactional SMTP unless deliverability testing fails.

Recommended sender:

- Domain: `auth.velance.org`
- From email: `no-reply@auth.velance.org`
- Sender name: `Velance`

## DNS Checklist

Configure these records before public launch:

- SPF for the authenticated sending domain.
- DKIM records supplied by Brevo.
- DMARC policy for the sending domain.

## Supabase Auth Settings

In Supabase Authentication settings:

- Enable custom SMTP.
- SMTP host: `smtp-relay.brevo.com`
- SMTP port: `587`
- SMTP user: Brevo SMTP login.
- SMTP password: Brevo SMTP key, not the Brevo API key.
- Sender email: `no-reply@auth.velance.org`
- Sender name: `Velance`

Set the email OTP template to match `VITE_AUTH_OTP_LENGTH`. The app defaults to `6`.

## Validation

- Send OTP to a new non-team address.
- Confirm delivery time is acceptable.
- Confirm spam placement is acceptable.
- Confirm the code length in email matches the app.
- Test resend and rate-limit behavior.
