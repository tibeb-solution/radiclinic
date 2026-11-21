import type { Metadata } from 'next'
import { ClinicLoginPage } from '@/components/clinic-login-page'

export const metadata: Metadata = {
  title: 'Clinic sign in | Molarcare',
  description: 'Secure sign in to your dental clinic workspace.',
}

export default function LoginPage() {
  return <ClinicLoginPage />
}
