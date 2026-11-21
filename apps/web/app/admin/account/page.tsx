import { redirect } from 'next/navigation'
import { getPlatformSession } from '@/app/auth-actions'
import { PlatformCredentialSettings } from '@/components/platform-credential-settings'

export default async function PlatformAccountPage() {
  const account = await getPlatformSession()
  if (!account) redirect('/admin/login')
  return <PlatformCredentialSettings currentEmail={account.email} />
}
