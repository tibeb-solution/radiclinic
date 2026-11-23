'use client'

import { type FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'
import { changeClinicPassword } from '@/app/auth-actions'
import { PasswordInput } from '@/components/password-input'

export function ClinicPasswordSetup({ clinicName }: { clinicName: string }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = await changeClinicPassword(
        String(form.get('currentPassword') ?? ''),
        String(form.get('newPassword') ?? '')
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.replace('/')
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Password update failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return <main className="password-setup-page">
    <section className="login-card password-setup-card">
      <div className="login-card-brand"><span><KeyRound /></span><span><small>CLINIC WORKSPACE</small><strong>{clinicName}</strong></span></div>
      <div className="login-card-rule" />
      <div className="login-card-heading"><h2>Choose a new password</h2><p>Your administrator issued a temporary password. Replace it to finish setting up your account.</p></div>
      <form className="clinic-login-form" onSubmit={submit}>
        <label className="login-field">Temporary password<PasswordInput name="currentPassword" autoComplete="current-password" required /></label>
        <label className="login-field">New password<PasswordInput name="newPassword" autoComplete="new-password" minLength={12} required /><small>Use at least 12 characters.</small></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-submit" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Set password'} <ArrowRight /></button>
      </form>
      <p className="login-ownership"><ShieldCheck /> Your password is stored as a salted hash.</p>
    </section>
  </main>
}
