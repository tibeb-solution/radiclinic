import type { Metadata } from 'next'
import { PlatformLoginPage } from '@/components/clinic-login-page'

export const metadata: Metadata = {
  title: 'Platform sign in | Clinic Care',
  description: 'Sign in to manage clinic organizations and their access.',
}

export default function PlatformLoginRoute() {
  return <PlatformLoginPage />
}
