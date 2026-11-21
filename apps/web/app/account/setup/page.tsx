import { redirect } from 'next/navigation'
import { getClinicSession } from '@/app/auth-actions'
import { ClinicPasswordSetup } from '@/components/clinic-password-setup'

export default async function AccountSetupPage() {
  const account = await getClinicSession()
  if (!account) redirect('/login')
  if (!account.mustChangePassword) redirect('/')
  return <ClinicPasswordSetup clinicName={account.clinicName ?? 'Clinic workspace'} />
}
