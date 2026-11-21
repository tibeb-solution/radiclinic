import { redirect } from 'next/navigation'
import { getClinicSession } from '@/app/auth-actions'
import { DentalDashboard } from '@/components/dental-dashboard'

export default async function Page() {
  const account = await getClinicSession()
  if (!account) redirect('/login')
  if (account.mustChangePassword) redirect('/account/setup')
  return <DentalDashboard
    clinicId={account.clinicId ?? account.id}
    clinicName={account.clinicName ?? 'Clinic workspace'}
    branchName={account.branchName ?? 'Main branch'}
    timezone={account.timezone ?? 'UTC'}
    plan={account.plan ?? 'Starter'}
  />
}
