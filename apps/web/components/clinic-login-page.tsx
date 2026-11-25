'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'
import { loginClinic, loginPlatformAdmin } from '@/app/auth-actions'
import { PasswordInput } from '@/components/password-input'

function SignInForm({ platform = false }: { platform?: boolean }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = platform
        ? await loginPlatformAdmin(String(form.get('email') ?? ''), String(form.get('password') ?? ''))
        : await loginClinic(String(form.get('email') ?? ''), String(form.get('password') ?? ''))
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.replace(platform ? '/admin' : '/')
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sign-in failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return <form className="clinic-login-form" onSubmit={submit}>
    <label className="login-field">Work email<input name="email" type="email" autoComplete="username" placeholder="you@yourclinic.com" required /></label>
    <label className="login-field">Password<PasswordInput name="password" autoComplete="current-password" placeholder="Enter your password" required /></label>
    {error && <p className="login-error" role="alert">{error}</p>}
    <button className="login-submit" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} <ArrowRight /></button>
  </form>
}

function LoginShell({ platform = false }: { platform?: boolean }) {
  const title = platform ? 'Platform administrator' : 'Clinic workspace'
  return <main className="clinic-login-page">
    <div className="login-topline">
      <Link className="portal-brand" href="/"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span className="brand-name">Clinic<span> Care</span></span></Link>
      <span className="login-powered"><Sparkles /> Tibeb Health platform</span>
    </div>
    <div className="login-layout">
      <section className="login-story">
        <div className="login-story-mark"><Building2 /></div>
        <div className="admin-kicker">{platform ? 'PLATFORM OPERATIONS' : 'YOUR CLINIC, CONNECTED'}</div>
        <h1>{platform ? <>Manage clinics.<br /><span>Build better care.</span></> : <>Care for your clinic.<br /><span>All in one place.</span></>}</h1>
        <p>{platform ? 'Provision clinic workspaces and manage administrator access from one secure console.' : 'One secure workspace for your team, your branches, and every step of the patient journey.'}</p>
        <div className="login-benefits">
          <span><CheckCircle2 /> {platform ? 'Manage clinic accounts and access' : 'Your clinic’s private workspace'}</span>
          <span><CheckCircle2 /> {platform ? 'Issue temporary sign-in credentials' : 'Access shaped around your role'}</span>
          <span><CheckCircle2 /> Supabase Auth and organization-scoped access</span>
        </div>
        <div className="login-story-footer"><ShieldCheck /> Passwords are protected and never stored in browser storage.</div>
      </section>
      <section className="login-card" aria-labelledby="clinic-signin-title">
        <div className="login-card-brand"><span><Building2 /></span><span><small>{platform ? 'PLATFORM CONSOLE' : 'CLINIC WORKSPACE'}</small><strong>{title}</strong></span></div>
        <div className="login-card-rule" />
        <div className="login-card-heading"><h2 id="clinic-signin-title">{platform ? 'Platform administrator sign in' : 'Sign in to your clinic'}</h2><p>{platform ? 'Use your Supabase Auth platform administrator account.' : 'Use the credentials provided by your clinic administrator.'}</p></div>
        <SignInForm platform={platform} />
        {platform && <p className="login-support">Clinic team? <Link href="/login">Go to clinic sign in</Link></p>}
        <div className="login-ownership"><LockKeyhole /> Secure authentication <strong>Tibeb Health</strong></div>
      </section>
    </div>
    <footer className="login-footer"><Link href="/"><ArrowLeft /> Back to Clinic Care</Link><span>© 2026 Tibeb Health <i /> Secure clinic platform</span></footer>
  </main>
}

export function ClinicLoginPage() {
  return <LoginShell />
}

export function PlatformLoginPage() {
  return <LoginShell platform />
}
