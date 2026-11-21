import 'server-only'

import { randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
export { newTemporaryPassword } from '@/lib/password'

export type AuthRealm = 'platform' | 'clinic'
export type ClinicStatus = 'active' | 'suspended'

export interface LocalClinic {
  id: string
  name: string
  email: string
  branchName: string
  plan: 'Starter' | 'Growth' | 'Enterprise'
  status: ClinicStatus
  passwordHash: string
  mustChangePassword: boolean
  createdAt: string
}

interface LocalPlatformAdmin {
  id: string
  email: string
  passwordHash: string
  mustChangePassword: boolean
}

interface LocalSession {
  tokenHash: string
  accountId: string
  realm: AuthRealm
  expiresAt: string
}

interface LocalAuthData {
  version: 1
  platformAdmin: LocalPlatformAdmin | null
  clinics: LocalClinic[]
  sessions: LocalSession[]
}

export interface AuthenticatedAccount {
  id: string
  realm: AuthRealm
  email: string
  displayName: string
  clinicId?: string
  clinicName?: string
  branchName?: string
  timezone?: string
  plan?: LocalClinic['plan']
  role?: string
  mustChangePassword: boolean
}

const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000
const dataDirectory = path.join(process.cwd(), '.data')
const dataFile = path.join(dataDirectory, 'auth.json')
let writeQueue = Promise.resolve()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateData(value: unknown): LocalAuthData {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.clinics) ||
    !Array.isArray(value.sessions) ||
    !(value.platformAdmin === null || isRecord(value.platformAdmin))
  ) {
    throw new Error(`Local authentication data is invalid: ${dataFile}`)
  }
  return value as unknown as LocalAuthData
}

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [algorithm, saltText, hashText] = storedHash.split('$')
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false

  const salt = Buffer.from(saltText, 'base64url')
  const expected = Buffer.from(hashText, 'base64url')
  const actual = scryptSync(password, salt, expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function validateAdminConfiguration(): { email: string; password: string } | null {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.PLATFORM_ADMIN_PASSWORD
  if (!email && !password) return null
  if (!email || !password) {
    throw new Error('Set both PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD to bootstrap the platform administrator.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
    throw new Error('PLATFORM_ADMIN_EMAIL must be valid and PLATFORM_ADMIN_PASSWORD must be at least 12 characters.')
  }
  return { email, password }
}

async function loadData(): Promise<LocalAuthData> {
  let contents: string
  try {
    contents = await readFile(dataFile, 'utf8')
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') throw error
    contents = ''
  }

  const data = contents
    ? validateData(JSON.parse(contents) as unknown)
    : { version: 1 as const, platformAdmin: null, clinics: [], sessions: [] }
  const adminConfig = validateAdminConfiguration()
  if (!data.platformAdmin && adminConfig) {
    data.platformAdmin = {
      id: randomBytes(16).toString('hex'),
      email: adminConfig.email,
      passwordHash: hashPassword(adminConfig.password),
      mustChangePassword: false,
    }
    await saveData(data)
  } else if (!contents) {
    await saveData(data)
  }
  if (data.platformAdmin?.mustChangePassword) {
    data.platformAdmin.mustChangePassword = false
    await saveData(data)
  }
  return data
}

async function saveData(data: LocalAuthData): Promise<void> {
  await mkdir(dataDirectory, { recursive: true })
  const temporaryFile = `${dataFile}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temporaryFile, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryFile, dataFile)
}

export async function withLocalAuthData<T>(
  operation: (data: LocalAuthData) => T | Promise<T>
): Promise<T> {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const previous = writeQueue
  writeQueue = previous.then(() => gate)
  await previous
  try {
    const data = await loadData()
    const result = await operation(data)
    await saveData(data)
    return result
  } finally {
    release()
  }
}

export async function readLocalAuthData(): Promise<LocalAuthData> {
  return withLocalAuthData((data) => data)
}

export function newAccountId(): string {
  return randomBytes(16).toString('hex')
}

export function storePassword(password: string): string {
  return hashPassword(password)
}

export function tokenDigest(token: string): string {
  return hashToken(token)
}

export function createSessionRecord(accountId: string, realm: AuthRealm, token: string): LocalSession {
  return {
    tokenHash: hashToken(token),
    accountId,
    realm,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS).toISOString(),
  }
}

export function findAccount(
  data: LocalAuthData,
  accountId: string,
  realm: AuthRealm
): AuthenticatedAccount | null {
  if (realm === 'platform') {
    const admin = data.platformAdmin
    return admin?.id === accountId
      ? {
          id: admin.id,
          realm,
          email: admin.email,
          displayName: 'Platform administrator',
          mustChangePassword: admin.mustChangePassword,
        }
      : null
  }

  const clinic = data.clinics.find((item) => item.id === accountId && item.status === 'active')
  return clinic
    ? {
        id: clinic.id,
        realm,
        email: clinic.email,
        displayName: clinic.name,
        clinicId: clinic.id,
        clinicName: clinic.name,
        branchName: clinic.branchName,
        plan: clinic.plan,
        mustChangePassword: clinic.mustChangePassword,
      }
    : null
}

export function publicClinic(clinic: LocalClinic): Omit<LocalClinic, 'passwordHash' | 'mustChangePassword'> {
  const { passwordHash: _passwordHash, mustChangePassword: _mustChangePassword, ...result } = clinic
  return result
}
