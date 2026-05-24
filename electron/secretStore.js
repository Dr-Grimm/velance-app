import { safeStorage } from 'electron'

const SECRET_PREFIX = 'velance-safe:v1:'

function canUseSafeStorage() {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.())
  } catch {
    return false
  }
}

export function isEncryptedSecret(value = '') {
  return String(value || '').startsWith(SECRET_PREFIX)
}

export function protectSecret(value = '') {
  const plain = String(value || '').trim()
  if (!plain) return ''
  if (isEncryptedSecret(plain)) return plain

  if (!canUseSafeStorage()) {
    return plain
  }

  try {
    return `${SECRET_PREFIX}${safeStorage.encryptString(plain).toString('base64')}`
  } catch {
    return plain
  }
}

export function revealSecret(value = '') {
  const stored = String(value || '').trim()
  if (!stored) return ''
  if (!isEncryptedSecret(stored)) return stored

  try {
    const payload = stored.slice(SECRET_PREFIX.length)
    return safeStorage.decryptString(Buffer.from(payload, 'base64')).trim()
  } catch {
    return ''
  }
}

export function hasStoredSecret(value = '') {
  return Boolean(String(value || '').trim())
}

export function maskSecret(value = '') {
  const plain = revealSecret(value)
  if (!plain) return ''
  if (plain.length <= 8) return 'Saved key'
  return `${plain.slice(0, 4)}...${plain.slice(-4)}`
}

export function resolveStoredSecretForSave(incoming = {}, existingStoredSecret = '') {
  if (incoming?.clearAiApiKey) return ''

  const candidate = String(
    incoming?.geminiApiKey
    || incoming?.aiApiKey
    || incoming?.apiKey
    || '',
  ).trim()
  if (candidate) return protectSecret(candidate)

  return String(existingStoredSecret || '')
}

export function publicSecretMeta(value = '') {
  const hasKey = hasStoredSecret(value)
  return {
    geminiApiKey: '',
    aiApiKey: '',
    apiKey: '',
    hasAiApiKey: hasKey,
    aiKeyPreview: hasKey ? maskSecret(value) : '',
    aiKeyStorage: hasKey
      ? (isEncryptedSecret(value) ? 'os-encrypted' : 'legacy-plain')
      : 'none',
  }
}
