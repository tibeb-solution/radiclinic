import { randomBytes } from 'node:crypto'

export function newTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const randomIndex = (maximum: number): number => {
    const limit = 256 - (256 % maximum)
    let value: number
    do {
      value = randomBytes(1)[0]
    } while (value >= limit)
    return value % maximum
  }
  const chunk = (length: number): string =>
    Array.from({ length }, () => alphabet[randomIndex(alphabet.length)]).join('')
  return `${chunk(4)}-${chunk(4)}-${chunk(4)}`
}
