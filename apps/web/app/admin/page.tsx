import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getPlatformSession, listManagedClinics } from '@/app/auth-actions'
import { ClinicAdminPage } from '@/components/clinic-admin-page'

export const metadata: Metadata = {
  title: 'Clinic organizations | Clinic Care',
  description: 'Manage clinic organizations and platform access.',
}

export default async function AdminPage() {
  const account = await getPlatformSession()
  if (!account) redirect('/admin/login')
  const clinics = await listManagedClinics()
  return <ClinicAdminPage clinics={clinics} adminEmail={account.email} />
}
