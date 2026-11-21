import { redirect } from 'next/navigation'
import { getPlatformSession } from '@/app/auth-actions'

export default async function PlatformAccountSetupPage() {
  const account = await getPlatformSession()
  if (!account) redirect('/admin/login')
  redirect('/admin')
}
