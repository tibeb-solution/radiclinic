import type { Metadata } from 'next'
import { ClinicLoginPage } from '@/components/clinic-login-page'

export const metadata: Metadata = {
  title: 'Clinic sign in | Clinic Care',
  description: 'Secure sign in to your dental clinic workspace.',
}

export default function LoginPage() {
  return <ClinicLoginPage />
}
