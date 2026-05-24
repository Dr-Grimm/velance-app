const DEFAULT_OTP_LENGTH = 6

function clampOtpLength(value = DEFAULT_OTP_LENGTH) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_OTP_LENGTH
  return Math.max(4, Math.min(10, parsed))
}

const envOtpLength = import.meta.env?.VITE_AUTH_OTP_LENGTH

export const AUTH_OTP_LENGTH = clampOtpLength(envOtpLength || DEFAULT_OTP_LENGTH)

export function getOtpCopyLabel(length = AUTH_OTP_LENGTH) {
  return `${length}-digit code`
}
