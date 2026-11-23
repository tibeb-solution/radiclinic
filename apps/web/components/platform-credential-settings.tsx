'use client'

import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react'
import { changePlatformCredentials, logout } from '@/app/auth-actions'
import { PasswordInput } from '@/components/password-input'

export function PlatformCredentialSettings({ currentEmail }: { currentEmail: string }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = await changePlatformCredentials(
        String(form.get('currentPassword') ?? ''),
        String(form.get('email') ?? ''),
        String(form.get('newPassword') ?? '')
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.replace('/admin')
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Credential update failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return <main className="password-setup-page">
    <section className="login-card password-setup-card">
      <div className="login-card-brand"><span><KeyRound /></span><span><small>PLATFORM CONSOLE</small><strong>Administrator credentials</strong></span></div>
      <div className="login-card-rule" />
      <div className="login-card-heading"><h2>Update administrator credentials</h2><p>Change your admin email or password. You can leave the password blank to keep it unchanged.</p></div>
      <form className="clinic-login-form" onSubmit={submit}>
        <label className="login-field">Current password<PasswordInput name="currentPassword" autoComplete="current-password" required /></label>
        <label className="login-field">Administrator email<input name="email" type="email" autoComplete="username" defaultValue={currentEmail} required /></label>
        <label className="login-field">New password<PasswordInput name="newPassword" autoComplete="new-password" minLength={12} /><small>Optional. If changing it, use at least 12 characters.</small></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-submit" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'} <KeyRound /></button>
      </form>
      <p className="login-ownership"><ShieldCheck /> Your credentials are managed by Supabase Auth.</p>
      <Link className="credential-back-link" href="/admin"><ArrowLeft /> Back to clinic management</Link>
      <form action={logout.bind(null, 'platform')} className="credential-signout"><button type="submit">Sign out</button></form>
    </section>
  </main>
}
