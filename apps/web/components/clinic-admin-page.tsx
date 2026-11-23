'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  KeyRound,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { createClinic, logout, resetClinicPassword, setClinicAdminActive, updateClinic } from '@/app/auth-actions'
import type { ManagedClinic } from '@/lib/clinic-types'

type PublicClinic = ManagedClinic
type CredentialNotice = { email: string; password: string }

function Brand() {
  return <Link className="portal-brand" href="/"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span className="brand-name">Clinic<span> Care</span></span></Link>
}

export function ClinicAdminPage({ clinics, adminEmail }: { clinics: PublicClinic[]; adminEmail: string }) {
  const router = useRouter()
  const [dialog, setDialog] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<PublicClinic | null>(null)
  const [credential, setCredential] = useState<CredentialNotice | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [updatingAdminId, setUpdatingAdminId] = useState('')
  const filteredClinics = clinics.filter((clinic) =>
    `${clinic.name} ${clinic.email}`.toLowerCase().includes(query.toLowerCase())
  )

  function openCreate() {
    setError('')
    setEditing(null)
    setCredential(null)
    setDialog('create')
  }

  function openEdit(clinic: PublicClinic) {
    setError('')
    setEditing(clinic)
    setDialog('edit')
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = await createClinic({
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        branchName: String(form.get('branchName') ?? ''),
        plan: String(form.get('plan') ?? ''),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCredential({ email: result.clinic.email, password: result.temporaryPassword })
      setDialog(null)
      setNotice('Clinic organization created.')
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Clinic creation failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    setError('')
    setSaving(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = await updateClinic({
        id: editing.id,
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        branchName: String(form.get('branchName') ?? ''),
        plan: String(form.get('plan') ?? ''),
        status: String(form.get('status') ?? ''),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDialog(null)
      setNotice('Clinic details updated.')
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Clinic update failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function issuePassword(clinic: PublicClinic) {
    setError('')
    try {
      const result = await resetClinicPassword(clinic.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCredential({ email: result.email, password: result.temporaryPassword })
      setNotice(`A new temporary password was issued for ${clinic.name}.`)
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not reset the clinic password.')
    }
  }

  async function toggleClinicAdminAccess(clinic: PublicClinic) {
    const active = !clinic.administratorActive
    if (!active && !window.confirm(
      `Pause administrator access for ${clinic.name}? Their clinic membership will be disabled, but all clinic data will be retained.`
    )) return

    setError('')
    setUpdatingAdminId(clinic.id)
    try {
      const result = await setClinicAdminActive(clinic.id, active)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice(active
        ? `Administrator access restored for ${clinic.name}.`
        : `Administrator access paused for ${clinic.name}. Clinic data was retained.`)
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update clinic administrator access.')
    } finally {
      setUpdatingAdminId('')
    }
  }

  return <div className="admin-page">
    <header className="admin-topbar"><Brand /><div className="admin-topbar-right"><span className="admin-env"><span /> Platform console</span><button className="admin-icon-button" aria-label="Help"><CircleHelp /></button><Link className="admin-credentials-link" href="/admin/account"><KeyRound /> Credentials</Link><div className="admin-user"><span className="admin-user-avatar">PA</span><span><strong>Platform Admin</strong><small>{adminEmail}</small></span><ChevronDown /></div><form action={logout.bind(null, 'platform')}><button className="admin-icon-button" aria-label="Sign out" title="Sign out"><LogOut /></button></form></div></header>
    <div className="admin-layout">
      <aside className="admin-sidebar"><div className="admin-sidebar-label">PLATFORM</div><Link className="admin-side-link admin-side-link-active" href="/admin"><Building2 /><span>Clinics</span><span className="admin-side-count">{clinics.length}</span></Link><div className="admin-sidebar-bottom"><div className="platform-provider"><span className="platform-provider-icon"><ShieldCheck /></span><span><small>CLINIC PLATFORM</small><strong>Tibeb Health</strong></span></div><Link className="admin-back-link" href="/login">Clinic sign in <ArrowRight /></Link></div></aside>
      <main className="admin-main"><div className="admin-content">
        <div className="admin-breadcrumb"><span>Platform</span><span>/</span><strong>Clinics</strong></div>
        <div className="admin-heading-row"><div><div className="admin-kicker">PLATFORM ADMINISTRATION</div><h1>Clinic organizations</h1><p>Create clinic accounts, manage access, and issue temporary credentials.</p></div><button className="admin-primary" onClick={openCreate}><Plus /> Add clinic</button></div>
        <div className="prototype-callout" role="note"><span className="prototype-callout-icon"><LockKeyhole /></span><span><strong>Supabase-backed clinic access</strong><small>Clinic accounts and organization records are stored in Supabase. Temporary passwords are shown once and must be changed at first sign-in. Pausing an administrator retains all clinic data.</small></span><span className="prototype-tag">SECURE</span></div>
        <section className="admin-stats" aria-label="Platform summary">
          <article><span>Clinic organizations</span><strong>{clinics.length}</strong><small>Stored in Supabase</small><i className="admin-stat-icon"><Building2 /></i></article>
          <article><span>Active clinics</span><strong>{clinics.filter((clinic) => clinic.status === 'active' && clinic.administratorActive).length}</strong><small>Clinic and administrator access enabled</small><i className="admin-stat-icon green"><Check /></i></article>
          <article><span>Clinic administrators</span><strong>{clinics.length}</strong><small>One per organization</small><i className="admin-stat-icon blue"><UsersRound /></i></article>
          <article><span>Suspended clinics</span><strong>{clinics.filter((clinic) => clinic.status === 'suspended').length}</strong><small>Access disabled</small><i className="admin-stat-icon amber"><LockKeyhole /></i></article>
        </section>
        {credential && <section className="credential-issued" role="status"><div><strong>Temporary credentials — share securely</strong><p>Send to {credential.email}. The clinic administrator must choose a new password at first sign-in.</p><code>{credential.password}</code></div><button className="admin-icon-button" onClick={() => setCredential(null)} aria-label="Dismiss credentials"><X /></button></section>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        <section className="admin-clinic-panel"><div className="admin-list-head"><div><div className="admin-list-title"><h2>All clinics</h2><span>{clinics.length}</span></div><p>Supabase organization records</p></div><div className="admin-list-actions"><label className="admin-search"><Search /><input aria-label="Search clinics" placeholder="Search clinics" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>CLINIC</th><th>ORGANIZATION ADMIN</th><th>BRANCH</th><th>PLAN</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filteredClinics.map((clinic) => <tr key={clinic.id}><td><div className="admin-clinic-cell"><span className="clinic-initials initials-mint">{clinic.name.slice(0, 2).toUpperCase()}</span><span><strong>{clinic.name}</strong><small>Added {new Date(clinic.createdAt).toLocaleDateString()}</small></span></div></td><td><span className="clinic-contact"><strong>{clinic.email}</strong><small className={clinic.administratorActive ? 'clinic-admin-access-active' : 'clinic-admin-access-paused'}>Administrator access · {clinic.administratorActive ? 'Active' : 'Paused'}</small></span></td><td>{clinic.branchName}</td><td><span className="plan-chip">{clinic.plan}</span></td><td><span className={`clinic-status clinic-status-${clinic.status}`}><i />{clinic.status === 'active' ? 'Active' : 'Suspended'}</span></td><td><div className="admin-row-actions"><button className="admin-row-menu" aria-label={`Edit ${clinic.name}`} title="Edit clinic" onClick={() => openEdit(clinic)}><Pencil /></button><button className="admin-row-menu" aria-label={`Issue new password for ${clinic.name}`} title="Issue temporary password" onClick={() => void issuePassword(clinic)}><KeyRound /></button><button className="admin-row-menu" aria-label={`${clinic.administratorActive ? 'Pause' : 'Restore'} administrator access for ${clinic.name}`} title={`${clinic.administratorActive ? 'Pause' : 'Restore'} administrator access`} disabled={updatingAdminId === clinic.id} onClick={() => void toggleClinicAdminAccess(clinic)}>{clinic.administratorActive ? <LockKeyhole /> : <Check />}</button></div></td></tr>)}</tbody></table>{filteredClinics.length === 0 && <div className="admin-no-results">No clinics match “{query}”.</div>}</div>
          <div className="admin-table-footer"><span>Showing {filteredClinics.length} clinic{filteredClinics.length === 1 ? '' : 's'} <span className="admin-footer-muted">· Supabase</span></span></div>
        </section>
        {notice && <div className="admin-toast" role="status"><ShieldCheck />{notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}><X /></button></div>}
        <section className="credential-info"><div className="credential-info-icon"><KeyRound /></div><div><strong>Credential handling</strong><p>Supabase Auth stores passwords securely. Use “Issue temporary password” to reset the clinic administrator password. Temporary passwords are shown once; the administrator must replace it before entering the workspace.</p></div><span className="local-storage-note">Supabase Auth</span></section>
      </div></main>
      {dialog && <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDialog(null) }}><section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="clinic-dialog-title"><div className="admin-dialog-head"><div><span className="admin-dialog-icon"><Building2 /></span><h2 id="clinic-dialog-title">{dialog === 'create' ? 'Add a clinic organization' : 'Edit clinic organization'}</h2><p>{dialog === 'create' ? 'Create its account and issue a one-time password.' : 'Update organization details and access status.'}</p></div><button className="admin-icon-button" onClick={() => setDialog(null)} aria-label="Close dialog"><X /></button></div><form onSubmit={dialog === 'create' ? submitCreate : submitEdit}>
        <label className="admin-field">Clinic name<input name="name" required maxLength={120} defaultValue={editing?.name ?? ''} placeholder="e.g. Willow Dental Studio" /></label>
        <label className="admin-field">Clinic administrator email<input name="email" required type="email" defaultValue={editing?.email ?? ''} placeholder="admin@clinic.com" /></label>
        <div className="admin-field-row"><label className="admin-field">Branch name<input name="branchName" required maxLength={100} defaultValue={editing?.branchName ?? ''} placeholder="e.g. Main Street" /></label><label className="admin-field">Subscription plan<select name="plan" defaultValue={editing?.plan ?? 'Starter'}><option>Starter</option><option>Growth</option><option>Enterprise</option></select></label></div>
        {dialog === 'edit' && <label className="admin-field">Account status<select name="status" defaultValue={editing?.status ?? 'active'}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="admin-dialog-footer"><button type="button" className="admin-secondary" onClick={() => setDialog(null)} disabled={saving}>Cancel</button><button type="submit" className="admin-primary" disabled={saving}>{dialog === 'create' ? <Plus /> : <Check />}{saving ? 'Saving…' : dialog === 'create' ? 'Create clinic' : 'Save changes'}</button></div>
      </form><p className="admin-dialog-footnote"><ShieldCheck /> Temporary passwords are generated randomly, stored as hashes, and shown only once.</p></section></div>}
    </div>
  </div>
}
