'use client'

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoctorMedicalAssessment,
  addMedicalHistoryAssessment,
  addTreatmentPlanStage,
  addTreatmentPlanStep,
  addOdontogramFinding,
  addDiagnosisCatalogEntry,
  addPatientHistoryEntry,
  addVisitDiagnosis,
  acknowledgeClinicalSafetyAlert,
  configureClinicalSafetyAlertRule,
  createAppointmentRecommendation,
  acceptAppointmentRecommendation,
  createClinicalSafetyAlert,
  createClinicalReferral,
  createClinicPrescription,
  createClinicTreatmentPlan,
  createClinicalEncounter,
  getClinicalAttachmentUrl,
  getClinicalPatientChart,
  recordPatientConsent,
  recordPerformedProcedure,
  recordClinicalSafetyDecision,
  recordClinicalOutcome,
  recordDiagnosisReassessment,
  reviewDiagnosisCatalogProposal,
  resolveClinicalSafetyAlert,
  escalateClinicalSafetyAlert,
  reviewClinicalRecord,
  searchDiagnosisCatalog,
  submitClinicalRecord,
  updateClinicalVisitCaseType,
  updateTreatmentPlanItemStatus,
  setPreferredDentalNotation,
  uploadClinicalAttachment,
  updateClinicPatientProfile,
  type ClinicalEncounterInput,
  type DiagnosisCatalogEntry,
  type ClinicalPatientChart,
} from '@/app/auth-actions'
import { ArrowLeft, Bell, Check, ClipboardPlus, FileHeart, HeartPulse, Plus, Stethoscope, UserRound } from 'lucide-react'

type ChartSection = 'profile' | 'history' | 'visits' | 'dental' | 'treatments' | 'safety' | 'documents'

const permanentTeeth = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '48', '47', '46', '45', '44', '43', '42', '41',
  '31', '32', '33', '34', '35', '36', '37', '38',
]
const primaryTeeth = [
  '55', '54', '53', '52', '51', '61', '62', '63', '64', '65',
  '85', '84', '83', '82', '81', '71', '72', '73', '74', '75',
]

const diagnosisCaseTypes = [
  ['general_dentistry', 'General dentistry'],
  ['orthodontic', 'Orthodontics'],
  ['endodontic', 'Endodontics'],
  ['periodontal', 'Periodontics'],
  ['oral_surgery', 'Oral surgery'],
  ['restorative', 'Restorative dentistry'],
  ['prosthodontic', 'Prosthodontics'],
] as const

const diagnosisSuggestions: Record<string, Array<{ name: string; category: string }>> = {
  general_dentistry: [
    { name: 'Dental caries', category: 'restorative' },
    { name: 'Tooth fracture', category: 'restorative' },
    { name: 'Tooth sensitivity', category: 'dental' },
    { name: 'Gingivitis', category: 'periodontal' },
    { name: 'Dental pulpitis', category: 'endodontic' },
  ],
  orthodontic: [
    { name: 'Malocclusion', category: 'orthodontic' },
    { name: 'Dental crowding', category: 'orthodontic' },
    { name: 'Dental spacing', category: 'orthodontic' },
    { name: 'Crossbite', category: 'orthodontic' },
    { name: 'Increased overjet', category: 'orthodontic' },
    { name: 'Open bite', category: 'orthodontic' },
    { name: 'Deep bite', category: 'orthodontic' },
  ],
  endodontic: [
    { name: 'Reversible pulpitis', category: 'endodontic' },
    { name: 'Irreversible pulpitis', category: 'endodontic' },
    { name: 'Pulp necrosis', category: 'endodontic' },
    { name: 'Apical periodontitis', category: 'endodontic' },
    { name: 'Periapical abscess', category: 'endodontic' },
  ],
  periodontal: [
    { name: 'Gingivitis', category: 'periodontal' },
    { name: 'Periodontitis', category: 'periodontal' },
    { name: 'Gingival recession', category: 'periodontal' },
    { name: 'Periodontal pocketing', category: 'periodontal' },
  ],
  oral_surgery: [
    { name: 'Impacted tooth', category: 'oral_surgery' },
    { name: 'Pericoronitis', category: 'oral_surgery' },
    { name: 'Retained tooth root', category: 'oral_surgery' },
    { name: 'Oral soft-tissue lesion', category: 'oral_surgery' },
  ],
  restorative: [
    { name: 'Dental caries', category: 'restorative' },
    { name: 'Tooth fracture', category: 'restorative' },
    { name: 'Defective restoration', category: 'restorative' },
    { name: 'Tooth wear', category: 'restorative' },
  ],
  prosthodontic: [
    { name: 'Partial edentulism', category: 'prosthodontic' },
    { name: 'Complete edentulism', category: 'prosthodontic' },
    { name: 'Tooth loss', category: 'prosthodontic' },
    { name: 'Failed dental prosthesis', category: 'prosthodontic' },
  ],
}

function categoryForCaseType(caseType: string): string {
  return caseType === 'general_dentistry' ? 'dental' : caseType
}

function ageAt(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null
  const birth = new Date(`${dateOfBirth}T12:00:00`)
  if (Number.isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  if (
    today.getMonth() < birth.getMonth()
    || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  ) age -= 1
  return age >= 0 ? age : null
}

function dateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return <label className="clinical-field"><span>{label}</span>{children}</label>
}

export function PatientClinicalChart({
  patientId,
  branchId,
  onClose,
  focusSafetyAlerts = false,
}: {
  patientId: string
  branchId: string
  onClose: () => void
  focusSafetyAlerts?: boolean
}) {
  const [chart, setChart] = useState<ClinicalPatientChart | null>(null)
  const [section, setSection] = useState<ChartSection>('profile')
  const [selectedVisitId, setSelectedVisitId] = useState('')
  const [selectedTooth, setSelectedTooth] = useState('')
  const [reviewRecordId, setReviewRecordId] = useState('')
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [openingAttachment, setOpeningAttachment] = useState('')
  const [updatingTreatmentId, setUpdatingTreatmentId] = useState('')
  const [diagnosisSearch, setDiagnosisSearch] = useState('')
  const [diagnosisSearchCategory, setDiagnosisSearchCategory] = useState('dental')
  const [diagnosisCatalogResults, setDiagnosisCatalogResults] = useState<DiagnosisCatalogEntry[]>([])
  const [selectedCatalogEntry, setSelectedCatalogEntry] = useState<DiagnosisCatalogEntry | null>(null)
  const [searchingDiagnosisCatalog, setSearchingDiagnosisCatalog] = useState(false)
  const [diagnosisName, setDiagnosisName] = useState('')
  const [diagnosisCode, setDiagnosisCode] = useState('')
  const [diagnosisCodeSystem, setDiagnosisCodeSystem] = useState('')
  const [diagnosisCategory, setDiagnosisCategory] = useState('dental')
  const [diagnosisDescription, setDiagnosisDescription] = useState('')
  const [diagnosisLocation, setDiagnosisLocation] = useState('')
  const [diagnosisCaseType, setDiagnosisCaseType] = useState('general_dentistry')
  const [proposalCatalogSearch, setProposalCatalogSearch] = useState('')
  const [proposalCatalogResults, setProposalCatalogResults] = useState<DiagnosisCatalogEntry[]>([])

  useEffect(() => {
    let active = true
    const query = diagnosisSearch.trim()
    if (query.length < 2) {
      setDiagnosisCatalogResults([])
      setSearchingDiagnosisCatalog(false)
      return
    }

    const timeout = window.setTimeout(async () => {
      setSearchingDiagnosisCatalog(true)
      try {
        const result = await searchDiagnosisCatalog(query, diagnosisSearchCategory)
        if (!active) return
        if (result.ok) {
          setDiagnosisCatalogResults(result.value)
        } else {
          setDiagnosisCatalogResults([])
          setFormError(result.error)
        }
      } catch (error) {
        if (active) {
          setDiagnosisCatalogResults([])
          setFormError(error instanceof Error ? error.message : 'Could not search the diagnosis catalog.')
        }
      } finally {
        if (active) setSearchingDiagnosisCatalog(false)
      }
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [diagnosisSearch, diagnosisSearchCategory])

  const reload = useCallback(async () => {
    try {
      const result = await getClinicalPatientChart(patientId)
      if (!result.ok) {
        setLoadError(result.error)
        return false
      }
      setChart(result.data)
      setLoadError('')
      setSelectedVisitId((current) =>
        result.data.visits.some((visit) => visit.id === current)
          ? current
          : result.data.visits[0]?.id ?? ''
      )
      return true
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load the patient chart.')
      return false
    }
  }, [patientId])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (focusSafetyAlerts) setSection('safety')
  }, [focusSafetyAlerts])

  const selectedVisit = useMemo(
    () => chart?.visits.find((visit) => visit.id === selectedVisitId) ?? null,
    [chart, selectedVisitId]
  )
  useEffect(() => {
    if (!selectedVisit) return
    setDiagnosisCaseType(selectedVisit.caseType)
    setDiagnosisSearchCategory(categoryForCaseType(selectedVisit.caseType))
  }, [selectedVisit?.id, selectedVisit?.caseType])

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    operation: (form: FormData) => Promise<{ ok: boolean; error?: string; value?: string }>,
    successMessage: string,
    resetOnSuccess = true,
    afterSuccess?: () => void
  ) {
    event.preventDefault()
    const formElement = event.currentTarget
    setSaving(true)
    setFormError('')
    setNotice('')
    try {
      const result = await operation(new FormData(formElement))
      if (!result.ok) {
        setFormError(result.error ?? 'The change could not be saved.')
        return
      }
      if (result.value) setSelectedVisitId(result.value)
      const refreshed = await reload()
      if (!refreshed) return
      if (resetOnSuccess) formElement.reset()
      afterSuccess?.()
      setNotice(successMessage)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The change could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function changeDiagnosisCaseType(caseType: string) {
    if (!selectedVisit || caseType === selectedVisit.caseType) return
    const previousCaseType = selectedVisit.caseType
    setDiagnosisCaseType(caseType)
    setDiagnosisSearchCategory(categoryForCaseType(caseType))
    setSaving(true)
    setFormError('')
    setNotice('')
    try {
      const result = await updateClinicalVisitCaseType(selectedVisit.id, caseType)
      if (!result.ok) {
        setDiagnosisCaseType(previousCaseType)
        setDiagnosisSearchCategory(categoryForCaseType(previousCaseType))
        setFormError(result.error)
        return
      }
      if (!await reload()) return
      setNotice('Visit case type updated. Previously recorded diagnoses are unchanged.')
    } catch (error) {
      setDiagnosisCaseType(previousCaseType)
      setDiagnosisSearchCategory(categoryForCaseType(previousCaseType))
      setFormError(error instanceof Error ? error.message : 'Visit case type could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  function chooseDiagnosisCatalogEntry(entry: DiagnosisCatalogEntry) {
    setSelectedCatalogEntry(entry)
    setDiagnosisName(entry.diagnosisName)
    setDiagnosisCode(entry.diagnosisCode ?? '')
    setDiagnosisCodeSystem(entry.codeSystem ?? '')
    setDiagnosisCategory(entry.category)
    setDiagnosisDescription(entry.description ?? '')
    setDiagnosisLocation(entry.anatomicalArea ?? '')
    setDiagnosisSearch(entry.diagnosisName)
  }

  async function saveDiagnosisCatalogEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setSaving(true)
    setFormError('')
    setNotice('')
    try {
      const result = await addDiagnosisCatalogEntry({
        name: String(form.get('catalogName') ?? ''),
        code: String(form.get('catalogCode') ?? ''),
        codeSystem: String(form.get('catalogCodeSystem') ?? ''),
        category: String(form.get('catalogCategory') ?? ''),
        description: String(form.get('catalogDescription') ?? ''),
        anatomicalArea: String(form.get('catalogArea') ?? ''),
        requiresTooth: form.get('catalogRequiresTooth') === 'on',
      })
      if (!result.ok) {
        setFormError(result.error)
        return
      }
      chooseDiagnosisCatalogEntry(result.value)
      formElement.reset()
      setNotice('Diagnosis added to the clinic catalog.')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not add the diagnosis to the clinic catalog.')
    } finally {
      setSaving(false)
    }
  }

  async function searchProposalCatalog() {
    try {
      const result = await searchDiagnosisCatalog(proposalCatalogSearch, 'all')
      if (!result.ok) {
        setFormError(result.error)
        return
      }
      setProposalCatalogResults(result.value)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not search the clinic catalog.')
    }
  }

  async function submitProposalReview(event: FormEvent<HTMLFormElement>, proposalId: string) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setFormError('')
    setNotice('')
    try {
      const result = await reviewDiagnosisCatalogProposal({
        proposalId,
        decision: String(form.get('proposalDecision') ?? '') as 'approved' | 'rejected' | 'clarification_requested' | 'merged',
        notes: String(form.get('proposalNotes') ?? ''),
        diagnosisName: String(form.get('proposalName') ?? ''),
        diagnosisCode: String(form.get('proposalCode') ?? ''),
        codeSystem: String(form.get('proposalCodeSystem') ?? ''),
        category: String(form.get('proposalCategory') ?? ''),
        catalogEntryId: String(form.get('proposalCatalogEntry') ?? ''),
      })
      if (!result.ok) {
        setFormError(result.error)
        return
      }
      if (!await reload()) return
      setNotice('Diagnosis catalog proposal review recorded.')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The catalog proposal review could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (!chart) {
    return <section className="patient-chart">
      <button className="chart-back-button" onClick={onClose}><ArrowLeft /> Patient directory</button>
      {loadError
        ? <p className="workspace-error" role="alert">{loadError}</p>
        : <p className="chart-loading" aria-live="polite">Loading the secure patient chart…</p>}
    </section>
  }

  const patient = chart.patient
  const age = ageAt(patient.dateOfBirth)
  const visibleExamination = selectedVisit
    ? chart.examinations.find((exam) => exam.visitId === selectedVisit.id)
    : undefined
  const visibleVitals = selectedVisit
    ? chart.vitals.find((vital) => vital.visitId === selectedVisit.id)
    : undefined
  const visibleDiagnoses = selectedVisit ? chart.diagnoses : []

  return <section className="patient-chart">
    <button className="chart-back-button" onClick={onClose}><ArrowLeft /> Patient directory</button>
    <header className="chart-patient-header">
      <div className="chart-patient-mark"><UserRound /></div>
      <div className="chart-patient-heading">
        <div className="eyebrow">PATIENT PROFILE · {patient.patientNumber}</div>
        <h1>{patient.fullName}</h1>
        <p>
          {age === null ? 'Age not provided' : `${age} years`}
          {patient.sex ? ` · ${patient.sex.replace('_', ' ')}` : ''}
          {patient.phone ? ` · ${patient.phone}` : ''}
        </p>
      </div>
      <span className={`status ${patient.status === 'active' ? 'status-checked-in' : ''}`}>{patient.status}</span>
    </header>

    {notice && <p className="chart-notice" role="status"><Check />{notice}</p>}
    {loadError && <p className="workspace-error" role="alert">{loadError}</p>}
    {formError && <p className="workspace-error" role="alert">{formError}</p>}

    <nav className="chart-tabs" aria-label="Patient chart sections">
      {([
        ['profile', 'Profile'],
        ['history', 'Medical & dental history'],
        ['visits', 'Visits & examination'],
        ['dental', 'Dental chart'],
        ['treatments', 'Plans & prescriptions'],
        ['safety', `Safety alerts${chart.clinicalSafetyAlerts.some((alert) => alert.status !== 'resolved') ? ` · ${chart.clinicalSafetyAlerts.filter((alert) => alert.status !== 'resolved').length}` : ''}`],
        ['documents', 'Documents & consent'],
      ] as const).map(([key, label]) => (
        <button
          key={key}
          className={section === key ? 'chart-tab chart-tab-active' : 'chart-tab'}
          onClick={() => setSection(key)}
          aria-current={section === key ? 'page' : undefined}
        >
          {label}
        </button>
      ))}
    </nav>

    {chart.clinicalSafetyAlerts.some((alert) => alert.criticality === 'critical' && alert.status !== 'resolved') && <button
      type="button"
      className="patient-critical-alert-banner"
      onClick={() => setSection('safety')}
    >
      <Bell />
      <span><strong>Critical clinical alert</strong><small>Open the safety alert panel to acknowledge or escalate.</small></span>
      <ArrowLeft className="critical-alert-chevron" />
    </button>}

    {section === 'profile' && <>
      <div className="chart-summary-grid">
        <article className="chart-summary-card"><span>Registered</span><strong>{dateTime(patient.createdAt)}</strong></article>
        <article className="chart-summary-card"><span>Recorded visits</span><strong>{chart.visits.length}</strong></article>
        <article className="chart-summary-card"><span>Medical &amp; dental entries</span><strong>{chart.historyEntries.length}</strong></article>
        <article className="chart-summary-card"><span>Dental findings</span><strong>{chart.odontogram.length}</strong></article>
      </div>
      <div className="chart-content-grid">
        <article className="panel chart-panel">
          <div className="panel-header"><div><h2>Personal information</h2><p>Keep contact details and emergency contact information current.</p></div></div>
          <form className="clinical-form" onSubmit={(event) => handleSubmit(event, async (form) =>
            updateClinicPatientProfile({
              patientId,
              fullName: String(form.get('fullName') ?? ''),
              dateOfBirth: String(form.get('dateOfBirth') ?? ''),
              sex: String(form.get('sex') ?? ''),
              phone: String(form.get('phone') ?? ''),
              email: String(form.get('email') ?? ''),
              nationalId: String(form.get('nationalId') ?? ''),
              address: String(form.get('address') ?? ''),
              emergencyContactName: String(form.get('emergencyContactName') ?? ''),
              emergencyContactPhone: String(form.get('emergencyContactPhone') ?? ''),
              emergencyContactRelationship: String(form.get('emergencyContactRelationship') ?? ''),
            }), 'Patient profile updated.', false)}>
            <Field label="Full name"><input name="fullName" defaultValue={patient.fullName} maxLength={120} required /></Field>
            <div className="clinical-grid">
              <Field label="Date of birth"><input name="dateOfBirth" type="date" defaultValue={patient.dateOfBirth ?? ''} /></Field>
              <Field label="Gender"><select name="sex" defaultValue={patient.sex ?? ''}><option value="">Not provided</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="not_specified">Prefer not to say</option></select></Field>
              <Field label="Phone"><input name="phone" type="tel" defaultValue={patient.phone ?? ''} maxLength={40} /></Field>
              <Field label="Email"><input name="email" type="email" defaultValue={patient.email ?? ''} maxLength={254} /></Field>
              <Field label="National ID"><input name="nationalId" defaultValue={patient.nationalId ?? ''} maxLength={80} /></Field>
              <Field label="Address"><input name="address" defaultValue={patient.address ?? ''} maxLength={500} /></Field>
              <Field label="Emergency contact"><input name="emergencyContactName" defaultValue={patient.emergencyContactName ?? ''} maxLength={120} /></Field>
              <Field label="Emergency phone"><input name="emergencyContactPhone" type="tel" defaultValue={patient.emergencyContactPhone ?? ''} maxLength={40} /></Field>
              <Field label="Relationship"><input name="emergencyContactRelationship" defaultValue={patient.emergencyContactRelationship ?? ''} maxLength={80} /></Field>
            </div>
            <button className="primary-button" disabled={saving}>{saving ? 'Saving profile…' : 'Save patient profile'} <Check /></button>
          </form>
        </article>
        <article className="panel chart-panel">
          <div className="panel-header"><div><h2>Latest clinical information</h2><p>Most recent measurements and visits.</p></div></div>
          {chart.vitals[0] ? <div className="chart-vitals-list">
            <span>Blood pressure <strong>{chart.vitals[0].bloodPressureSystolic ?? '—'}/{chart.vitals[0].bloodPressureDiastolic ?? '—'} mmHg</strong></span>
            <span>Pulse <strong>{chart.vitals[0].pulseBpm ?? '—'} bpm</strong></span>
            <span>Temperature <strong>{chart.vitals[0].temperatureC ?? '—'} °C</strong></span>
            <span>Oxygen saturation <strong>{chart.vitals[0].oxygenSaturation ?? '—'}%</strong></span>
            <small>Recorded {dateTime(chart.vitals[0].recordedAt)}</small>
          </div> : <p className="chart-empty">No vital signs have been recorded.</p>}
        </article>
      </div>
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Recent visits</h2><p>Each encounter is preserved as a separate record.</p></div><button className="text-link" onClick={() => setSection('visits')}>Open visit history</button></div>
        {chart.visits.length ? <div className="chart-timeline">{chart.visits.slice(0, 5).map((visit) => (
          <button key={visit.id} className="chart-timeline-row" onClick={() => { setSelectedVisitId(visit.id); setSection('visits') }}>
            <span className="chart-timeline-mark"><Stethoscope /></span>
            <span><strong>{visit.visitType}</strong><small>{visit.visitNumber} · {visit.chiefComplaint || visit.reason || 'No complaint entered'}</small></span>
            <time>{dateTime(visit.visitedAt)}</time>
          </button>
        ))}</div> : <p className="chart-empty">No visits yet. Create the first encounter from Visits &amp; examination.</p>}
      </article>
    </>}

    {section === 'history' && <div className="chart-content-grid">
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Append to medical &amp; dental history</h2><p>Entries are timestamped and preserved rather than replacing earlier history.</p></div></div>
        <form className="clinical-form" onSubmit={(event) => handleSubmit(event, async (form) =>
          addPatientHistoryEntry({
            patientId,
            category: String(form.get('category')) as 'general_medical' | 'dental',
            entryType: String(form.get('entryType') ?? ''),
            details: String(form.get('details') ?? ''),
            source: String(form.get('source') ?? ''),
            verified: form.get('verified') === 'on',
          }), 'History entry added to the patient timeline.')}>
          <div className="clinical-grid">
            <Field label="History section"><select name="category"><option value="general_medical">General medical</option><option value="dental">Dental</option></select></Field>
            <Field label="Entry type"><input name="entryType" maxLength={100} placeholder="Allergy, medication, surgery…" required /></Field>
          </div>
          <Field label="Details"><textarea name="details" rows={3} maxLength={3000} required placeholder="Record what the patient reported or what was verified." /></Field>
          <Field label="Information source"><select name="source"><option value="patient_reported">Reported by patient</option><option value="caregiver_reported">Reported by caregiver</option><option value="prior_records">Prior medical records</option><option value="clinician_observed">Clinician observed</option></select></Field>
          <label className="clinical-check"><input name="verified" type="checkbox" /> Clinician verified this information</label>
          <button className="primary-button" disabled={saving}><Plus /> Add history entry</button>
        </form>
      </article>
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Source-separated clinical assessment</h2><p>Patient, nursing and doctor entries remain independent. Use structured JSON only for coded answers and Review of Systems.</p></div></div>
        <form className="clinical-form" onSubmit={(event) => handleSubmit(event, async (form) => {
          let answers: Record<string, unknown> = {}
          let reviewOfSystems: Record<string, unknown> = {}
          try {
            answers = JSON.parse(String(form.get('assessmentAnswers') || '{}')) as Record<string, unknown>
            reviewOfSystems = JSON.parse(String(form.get('reviewOfSystems') || '{}')) as Record<string, unknown>
          } catch {
            setFormError('Answers and Review of Systems must be valid JSON objects.')
            return { ok: false, error: 'Answers and Review of Systems must be valid JSON objects.' }
          }
          return addMedicalHistoryAssessment({
            patientId,
            branchId,
            visitId: String(form.get('assessmentVisit') ?? ''),
            source: String(form.get('assessmentSource') ?? 'patient_reported') as 'patient_reported' | 'nursing_assessment' | 'doctor_assessment',
            collectionMethod: String(form.get('collectionMethod') ?? ''),
            answers,
            reviewOfSystems,
            clinicalNotes: String(form.get('assessmentNotes') ?? ''),
            verificationStatus: String(form.get('verificationStatus') ?? 'unverified') as 'unverified' | 'reviewed' | 'verified' | 'not_verified' | 'requires_clarification' | 'disputed' | 'not_clinically_relevant',
            verificationNote: String(form.get('verificationNote') ?? ''),
          })
        }, 'Source-separated clinical assessment saved.')}>
          <div className="clinical-grid">
            <Field label="Information source"><select name="assessmentSource"><option value="patient_reported">Patient reported</option><option value="nursing_assessment">Nursing assessment</option><option value="doctor_assessment">Doctor assessment</option></select></Field>
            <Field label="Related visit"><select name="assessmentVisit" defaultValue={selectedVisitId}><option value="">No visit linked</option>{chart.visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.visitNumber}</option>)}</select></Field>
          </div>
          <Field label="Collection method"><input name="collectionMethod" maxLength={200} placeholder="Questionnaire, interview, nursing intake…" /></Field>
          <Field label="Structured answers (JSON)"><textarea name="assessmentAnswers" rows={4} maxLength={10000} defaultValue={'{}'} /></Field>
          <Field label="Review of Systems (JSON)"><textarea name="reviewOfSystems" rows={4} maxLength={10000} defaultValue={'{}'} /></Field>
          <Field label="Clinical notes"><textarea name="assessmentNotes" rows={2} maxLength={5000} /></Field>
          <div className="clinical-grid">
            <Field label="Verification status"><select name="verificationStatus"><option value="unverified">Unverified</option><option value="reviewed">Reviewed</option><option value="verified">Verified</option><option value="not_verified">Not verified</option><option value="requires_clarification">Requires clarification</option><option value="disputed">Disputed / inconsistent</option><option value="not_clinically_relevant">Not clinically relevant</option></select></Field>
            <Field label="Verification note"><input name="verificationNote" maxLength={2000} /></Field>
          </div>
          <button className="primary-button" disabled={saving}><Plus /> Save assessment</button>
        </form>
      </article>
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Doctor medical assessment</h2><p>Records the clinical conclusion without replacing patient or nursing source records.</p></div></div>
        <form className="clinical-form" onSubmit={(event) => handleSubmit(event, async (form) =>
          addDoctorMedicalAssessment({
            patientId,
            branchId,
            visitId: String(form.get('doctorAssessmentVisit') ?? ''),
            medicalHistoryReview: {},
            systemicAssessment: {},
            clinicalRiskAssessment: {},
            clinicalConclusion: String(form.get('clinicalConclusion') ?? ''),
            differentialDiagnoses: [],
            investigationsRequired: [],
            referrals: [],
            treatmentPrecautions: String(form.get('treatmentPrecautions') ?? ''),
            recommendations: String(form.get('doctorRecommendations') ?? ''),
          }), 'Doctor medical assessment saved.')}>
          <Field label="Related visit"><select name="doctorAssessmentVisit" required defaultValue={selectedVisitId}><option value="">Select a visit</option>{chart.visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.visitNumber}</option>)}</select></Field>
          <Field label="Clinical conclusion"><textarea name="clinicalConclusion" rows={3} maxLength={5000} /></Field>
          <Field label="Treatment precautions"><textarea name="treatmentPrecautions" rows={2} maxLength={3000} /></Field>
          <Field label="Recommendations"><textarea name="doctorRecommendations" rows={2} maxLength={3000} /></Field>
          <button className="primary-button" disabled={saving}><Stethoscope /> Save doctor assessment</button>
        </form>
      </article>
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>History timeline</h2><p>{chart.historyEntries.length} preserved entr{chart.historyEntries.length === 1 ? 'y' : 'ies'}</p></div></div>
        {chart.medicalAssessments.length ? <div className="chart-timeline">{chart.medicalAssessments.map((assessment) => (
          <article className="chart-history-entry" key={assessment.id}>
            <span className="chart-entry-tag">{assessment.source.replaceAll('_', ' ')} · {assessment.verificationStatus.replaceAll('_', ' ')}</span>
            {assessment.collectionMethod && <small>Collection: {assessment.collectionMethod}</small>}
            {assessment.clinicalNotes && <p>{assessment.clinicalNotes}</p>}
            <small>{dateTime(assessment.recordedAt)}</small>
          </article>
        ))}</div> : null}
        {chart.historyEntries.length ? <div className="chart-timeline">{chart.historyEntries.map((entry) => (
          <article className="chart-history-entry" key={entry.id}>
            <span className="chart-entry-tag">{entry.category === 'dental' ? 'Dental' : 'Medical'} · {entry.entryType}</span>
            <p>{entry.details}</p><small>{entry.source.replaceAll('_', ' ')} · {entry.verificationStatus} · {dateTime(entry.recordedAt)}</small>
          </article>
        ))}</div> : <p className="chart-empty">No previous history has been recorded.</p>}
      </article>
    </div>}

    {section === 'visits' && <div className="chart-content-grid">
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Start a new encounter</h2><p>Review the permanent profile before recording new visit details.</p></div></div>
        <form className="clinical-form" onSubmit={(event) => handleSubmit(event, async (form) => {
          const value = (key: string) => String(form.get(key) ?? '')
          const input: ClinicalEncounterInput = {
            patientId,
            branchId,
            visitType: value('visitType'),
            caseType: value('caseType'),
            reason: value('reason'),
            chiefComplaint: value('chiefComplaint'),
            historyReviewed: form.get('historyReviewed') === 'on',
            followUp: value('followUp'),
            exam: {
              historyOfPresentIllness: value('historyOfPresentIllness'),
              extraoralExamination: value('extraoralExamination'),
              intraoralExamination: value('intraoralExamination'),
              toothExamination: value('toothExamination'),
              periodontalExamination: value('periodontalExamination'),
              softTissueExamination: value('softTissueExamination'),
              radiographicFindings: value('radiographicFindings'),
              otherObservations: value('otherObservations'),
            },
            vitals: {
              bloodPressureSystolic: value('bloodPressureSystolic'),
              bloodPressureDiastolic: value('bloodPressureDiastolic'),
              pulseBpm: value('pulseBpm'),
              temperatureC: value('temperatureC'),
              respiratoryRate: value('respiratoryRate'),
              oxygenSaturation: value('oxygenSaturation'),
              bloodGlucose: value('bloodGlucose'),
              weightKg: value('weightKg'),
              heightCm: value('heightCm'),
              notes: value('vitalNotes'),
              source: value('vitalSource'),
            },
          }
          const result = await createClinicalEncounter(input)
          return result
        }, 'New encounter saved with examination and recorded measurements.')}>
          <div className="clinical-grid">
            <Field label="Visit type"><select name="visitType"><option value="consultation">Consultation</option><option value="emergency">Emergency</option><option value="follow_up">Follow-up</option><option value="procedure">Procedure</option></select></Field>
            <Field label="Clinical case type"><select name="caseType" defaultValue="general_dentistry">
              {diagnosisCaseTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></Field>
            <Field label="Reason for visit"><input name="reason" maxLength={500} /></Field>
          </div>
          <Field label="Chief complaint"><textarea name="chiefComplaint" rows={2} maxLength={1500} /></Field>
          <Field label="History of present illness"><textarea name="historyOfPresentIllness" rows={2} maxLength={3000} /></Field>
          <details className="clinical-details">
            <summary><HeartPulse /> Vital signs <span>Optional measurements are stored with this visit.</span></summary>
            <div className="clinical-grid clinical-vitals-grid">
              <Field label="Blood pressure (systolic)"><input name="bloodPressureSystolic" inputMode="numeric" type="number" min="40" max="300" /></Field>
              <Field label="Blood pressure (diastolic)"><input name="bloodPressureDiastolic" inputMode="numeric" type="number" min="20" max="200" /></Field>
              <Field label="Pulse (bpm)"><input name="pulseBpm" inputMode="numeric" type="number" min="20" max="250" /></Field>
              <Field label="Temperature (°C)"><input name="temperatureC" inputMode="decimal" type="number" min="25" max="45" step="0.1" /></Field>
              <Field label="Respiratory rate"><input name="respiratoryRate" inputMode="numeric" type="number" min="1" max="100" /></Field>
              <Field label="Oxygen saturation (%)"><input name="oxygenSaturation" inputMode="decimal" type="number" min="0" max="100" step="0.1" /></Field>
              <Field label="Blood glucose"><input name="bloodGlucose" inputMode="decimal" type="number" min="0" step="0.1" /></Field>
              <Field label="Weight (kg)"><input name="weightKg" inputMode="decimal" type="number" min="0" max="500" step="0.1" /></Field>
              <Field label="Height (cm)"><input name="heightCm" inputMode="decimal" type="number" min="0" max="300" step="0.1" /></Field>
            </div>
            <Field label="Measurement source"><select name="vitalSource"><option value="measured">Measured by clinic</option><option value="patient_reported">Reported by patient</option><option value="prior_records">Prior records</option></select></Field>
            <Field label="Measurement notes"><textarea name="vitalNotes" rows={2} maxLength={1000} /></Field>
          </details>
          <details className="clinical-details">
            <summary><Stethoscope /> Structured examination <span>Document relevant findings for this encounter.</span></summary>
            <div className="clinical-grid">
              <Field label="Extraoral examination"><textarea name="extraoralExamination" rows={2} maxLength={3000} /></Field>
              <Field label="Intraoral examination"><textarea name="intraoralExamination" rows={2} maxLength={3000} /></Field>
              <Field label="Tooth examination"><textarea name="toothExamination" rows={2} maxLength={3000} /></Field>
              <Field label="Gum &amp; periodontal examination"><textarea name="periodontalExamination" rows={2} maxLength={3000} /></Field>
              <Field label="Soft-tissue examination"><textarea name="softTissueExamination" rows={2} maxLength={3000} /></Field>
              <Field label="Radiographic findings"><textarea name="radiographicFindings" rows={2} maxLength={3000} /></Field>
              <Field label="Other observations"><textarea name="otherObservations" rows={2} maxLength={3000} /></Field>
            </div>
          </details>
          <Field label="Follow-up instructions"><textarea name="followUp" rows={2} maxLength={1500} /></Field>
          <label className="clinical-check"><input name="historyReviewed" type="checkbox" /> I reviewed the patient’s medical and dental history for this visit.</label>
          <button className="primary-button" disabled={saving}><ClipboardPlus /> {saving ? 'Saving encounter…' : 'Save visit and exam'}</button>
        </form>
      </article>

      <div className="chart-stack">
        <article className="panel chart-panel">
          <div className="panel-header"><div><h2>Visit history</h2><p>Choose an encounter to review its details.</p></div></div>
          {chart.visits.length ? <div className="chart-timeline">{chart.visits.map((visit) => (
            <button key={visit.id} className={`chart-visit-select ${visit.id === selectedVisitId ? 'chart-visit-selected' : ''}`} onClick={() => setSelectedVisitId(visit.id)}>
              <strong>{visit.visitType.replaceAll('_', ' ')} · {visit.visitNumber}</strong>
              <span>{visit.chiefComplaint || visit.reason || 'No complaint entered'}</span>
              <small>{dateTime(visit.visitedAt)}</small>
            </button>
          ))}</div> : <p className="chart-empty">No encounters yet.</p>}
        </article>
        {selectedVisit && <article className="panel chart-panel">
          <div className="panel-header"><div><h2>Selected encounter</h2><p>{selectedVisit.visitNumber} · {dateTime(selectedVisit.visitedAt)}</p></div></div>
          <div className="chart-encounter-details">
            <p><strong>Reason</strong><span>{selectedVisit.reason || 'Not recorded'}</span></p>
            <p><strong>Chief complaint</strong><span>{selectedVisit.chiefComplaint || 'Not recorded'}</span></p>
            <p><strong>History reviewed</strong><span>{selectedVisit.medicalHistoryReviewed ? 'Yes' : 'Not marked as reviewed'}</span></p>
            {visibleExamination && <p><strong>Examination</strong><span>{visibleExamination.intraoralExamination || visibleExamination.extraoralExamination || visibleExamination.otherObservations || 'No examination notes'}</span></p>}
            {visibleVitals && <p><strong>Vital signs</strong><span>{visibleVitals.bloodPressureSystolic ?? '—'}/{visibleVitals.bloodPressureDiastolic ?? '—'} mmHg · {visibleVitals.pulseBpm ?? '—'} bpm · {visibleVitals.temperatureC ?? '—'} °C</span></p>}
            <p><strong>Follow-up</strong><span>{selectedVisit.followUpInstructions || 'None recorded'}</span></p>
          </div>
          <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
            addVisitDiagnosis({
              visitId: selectedVisit.id,
              catalogEntryId: selectedCatalogEntry?.id ?? '',
              name: diagnosisName,
              code: diagnosisCode,
              codeSystem: diagnosisCodeSystem,
              category: diagnosisCategory,
              description: diagnosisDescription,
              location: diagnosisLocation,
              toothNumbers: String(form.get('diagnosisTeeth') ?? '')
                .split(',')
                .map((tooth) => tooth.trim())
                .filter(Boolean),
              toothSurface: String(form.get('diagnosisSurface') ?? 'whole_tooth'),
              severity: String(form.get('diagnosisSeverity') ?? 'unspecified'),
              findings: String(form.get('diagnosisFindings') ?? ''),
              clinicalNotes: String(form.get('diagnosisClinicalNotes') ?? ''),
              certainty: String(form.get('diagnosisCertainty') ?? 'provisional'),
              priority: String(form.get('diagnosisPriority') ?? 'routine'),
              reasoning: String(form.get('diagnosisReasoning') ?? ''),
              conflictingFindings: String(form.get('diagnosisConflictingFindings') ?? ''),
              requiredInvestigations: String(form.get('diagnosisInvestigations') ?? ''),
              priorityReason: String(form.get('diagnosisPriorityReason') ?? ''),
              caseType: diagnosisCaseType,
              overrideReason: String(form.get('diagnosisOverrideReason') ?? ''),
              proposeForCatalog: form.get('diagnosisProposeForCatalog') === 'on',
            }), 'Diagnosis added to the selected visit.', true, () => {
              setSelectedCatalogEntry(null)
              setDiagnosisSearch('')
              setDiagnosisName('')
              setDiagnosisCode('')
              setDiagnosisCodeSystem('')
              setDiagnosisCategory('dental')
              setDiagnosisDescription('')
              setDiagnosisLocation('')
            })}>
            <h3>Add diagnosis</h3>
            <div className="clinical-grid">
              <Field label="Clinical case type"><select value={diagnosisCaseType} onChange={(event) => void changeDiagnosisCaseType(event.target.value)} disabled={saving}>
                {diagnosisCaseTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></Field>
              <Field label="Search diagnosis category"><select value={diagnosisSearchCategory} onChange={(event) => setDiagnosisSearchCategory(event.target.value)}>
                <option value={categoryForCaseType(diagnosisCaseType)}>Current specialty recommendations</option>
                <option value="all">Other categories (search only)</option>
                <option value="general_medical">General medical</option><option value="dental">Dental</option><option value="periodontal">Periodontal</option><option value="oral_surgery">Oral surgery</option><option value="restorative">Restorative</option><option value="endodontic">Endodontic</option><option value="orthodontic">Orthodontic</option><option value="prosthodontic">Prosthodontic</option><option value="other">Other</option>
              </select></Field>
            </div>
            <p className="workspace-help-copy">Recommendations are suggestions only. The clinician selects and documents every diagnosis.</p>
            <div className="diagnosis-recommendation-list" aria-label="Specialty diagnosis recommendations">
              {(diagnosisSuggestions[diagnosisCaseType] ?? [])
                .filter((suggestion) => !diagnosisSearch.trim()
                  || suggestion.name.toLowerCase().includes(diagnosisSearch.trim().toLowerCase()))
                .map((suggestion) => (
                  <button
                    type="button"
                    key={`${suggestion.category}-${suggestion.name}`}
                    className="diagnosis-recommendation"
                    onClick={() => {
                      setDiagnosisName(suggestion.name)
                      setDiagnosisCategory(suggestion.category)
                      setSelectedCatalogEntry(null)
                      setDiagnosisSearch('')
                    }}
                  >{suggestion.name}</button>
                ))}
            </div>
            <Field label="Search clinic diagnosis catalog in the selected category">
              <input
                value={diagnosisSearch}
                onChange={(event) => setDiagnosisSearch(event.target.value)}
                maxLength={100}
                placeholder="Type at least two characters to search"
                aria-label="Search clinic diagnosis catalog by selected category"
              />
            </Field>
            {searchingDiagnosisCatalog && <p className="chart-empty" aria-live="polite">Searching diagnoses…</p>}
            {diagnosisCatalogResults.length > 0 && <div className="chart-diagnosis-list" role="listbox" aria-label="Diagnosis catalog results">
              {diagnosisCatalogResults.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  role="option"
                  aria-selected={selectedCatalogEntry?.id === entry.id}
                  className="chart-visit-select"
                  onClick={() => chooseDiagnosisCatalogEntry(entry)}
                >
                  <strong>{entry.diagnosisName}</strong>
                  <span>{[entry.diagnosisCode, entry.codeSystem, entry.category.replaceAll('_', ' ')].filter(Boolean).join(' · ')}</span>
                  {entry.description && <small>{entry.description}</small>}
                </button>
              ))}
            </div>}
            {selectedCatalogEntry && <p className="chart-notice">Selected from the clinic catalog. You can still add visit-specific findings and notes.</p>}
            {!selectedCatalogEntry && diagnosisName && <p className="workspace-help-copy">Manual diagnosis entry. This patient diagnosis will not change the clinic catalog.</p>}
            <Field label="Diagnosis"><input name="diagnosisName" value={diagnosisName} onChange={(event) => {
              setDiagnosisName(event.target.value)
              setSelectedCatalogEntry(null)
            }} maxLength={200} required /></Field>
            <div className="clinical-grid">
              <Field label="Code (optional)"><input name="diagnosisCode" value={diagnosisCode} onChange={(event) => setDiagnosisCode(event.target.value)} maxLength={50} /></Field>
              <Field label="Code system (optional)"><input name="diagnosisCodeSystem" value={diagnosisCodeSystem} onChange={(event) => setDiagnosisCodeSystem(event.target.value)} maxLength={40} placeholder="e.g. ICD-10" /></Field>
              <Field label="Category"><select name="diagnosisCategory" value={diagnosisCategory} onChange={(event) => setDiagnosisCategory(event.target.value)} disabled={Boolean(selectedCatalogEntry)}>
                <option value="general_medical">General medical</option><option value="dental">Dental</option><option value="periodontal">Periodontal</option><option value="oral_surgery">Oral surgery</option><option value="restorative">Restorative</option><option value="endodontic">Endodontic</option><option value="orthodontic">Orthodontic</option><option value="prosthodontic">Prosthodontic</option><option value="other">Other</option>
              </select></Field>
              <Field label="Severity"><select name="diagnosisSeverity" defaultValue="unspecified">
                <option value="unspecified">Unspecified</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option><option value="critical">Critical</option>
              </select></Field>
              <Field label="Diagnostic certainty"><select name="diagnosisCertainty" defaultValue="provisional">
                <option value="suspected">Suspected</option><option value="provisional">Provisional</option><option value="confirmed">Confirmed</option><option value="differential">Differential</option>
              </select></Field>
              <Field label="Priority"><select name="diagnosisPriority" defaultValue="routine">
                <option value="routine">Routine</option><option value="priority">Priority</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
              </select></Field>
              <Field label="Tooth numbers (optional, comma-separated)"><input name="diagnosisTeeth" inputMode="numeric" maxLength={100} placeholder="e.g. 16, 17" /></Field>
              <Field label="Tooth surface"><select name="diagnosisSurface" defaultValue="whole_tooth">
                <option value="whole_tooth">Whole tooth</option><option value="mesial">Mesial</option><option value="distal">Distal</option><option value="occlusal">Occlusal</option><option value="buccal">Buccal</option><option value="lingual_palatal">Lingual / palatal</option>
              </select></Field>
            </div>
            <Field label="Anatomical location (optional)"><input name="diagnosisLocation" value={diagnosisLocation} onChange={(event) => setDiagnosisLocation(event.target.value)} maxLength={200} placeholder="e.g. gingiva, soft tissue, oral mucosa" /></Field>
            <Field label="Clinical description"><textarea name="diagnosisDescription" value={diagnosisDescription} onChange={(event) => setDiagnosisDescription(event.target.value)} rows={2} maxLength={1500} /></Field>
            <Field label="Diagnostic reasoning"><textarea name="diagnosisReasoning" rows={2} maxLength={2000} required placeholder="Why is this diagnosis being considered?" /></Field>
            <Field label="Supporting findings"><textarea name="diagnosisFindings" rows={2} maxLength={1500} /></Field>
            <Field label="Conflicting findings (optional)"><textarea name="diagnosisConflictingFindings" rows={2} maxLength={2000} /></Field>
            <Field label="Required investigations (optional)"><textarea name="diagnosisInvestigations" rows={2} maxLength={2000} /></Field>
            <Field label="Reason for non-routine priority (required for priority, urgent, or emergency)"><textarea name="diagnosisPriorityReason" rows={2} maxLength={1000} /></Field>
            <Field label="Clinical notes"><textarea name="diagnosisClinicalNotes" rows={2} maxLength={1500} /></Field>
            {diagnosisCaseType !== 'general_dentistry'
              && diagnosisCategory !== diagnosisCaseType
              && diagnosisCategory !== 'general_medical'
              && diagnosisCategory !== 'other'
              && <p className="diagnosis-relevance-warning" role="status">
                This diagnosis category differs from the selected {diagnosisCaseType.replaceAll('_', ' ')} case. Add a clinical justification to continue; the diagnosis will still be recorded under its own category.
              </p>}
            {diagnosisName && chart.diagnoses.some((diagnosis) =>
              diagnosis.visitId === selectedVisit.id
              && diagnosis.status !== 'entered_in_error'
              && diagnosis.category === diagnosisCategory
              && diagnosis.diagnosisName.trim().toLowerCase() === diagnosisName.trim().toLowerCase()
            ) && <p className="diagnosis-relevance-warning" role="status">
              A diagnosis with this name and category is already recorded for this visit. Review it before adding a duplicate; an explanation is required to proceed.
            </p>}
            {((diagnosisCaseType !== 'general_dentistry'
              && diagnosisCategory !== diagnosisCaseType
              && diagnosisCategory !== 'general_medical'
              && diagnosisCategory !== 'other')
              || (diagnosisName && chart.diagnoses.some((diagnosis) =>
                diagnosis.visitId === selectedVisit.id
                && diagnosis.status !== 'entered_in_error'
                && diagnosis.category === diagnosisCategory
                && diagnosis.diagnosisName.trim().toLowerCase() === diagnosisName.trim().toLowerCase()
              ))) && <Field label="Clinical justification for the specialty override or repeat diagnosis">
                <textarea name="diagnosisOverrideReason" rows={2} maxLength={1000} required />
              </Field>}
            {!selectedCatalogEntry && <label className="clinical-check">
              <input name="diagnosisProposeForCatalog" type="checkbox" />
              Propose this manually entered diagnosis for clinical catalog review (does not approve or alter the patient diagnosis)
            </label>}
            <button className="secondary-button" disabled={saving}><Plus /> Add diagnosis</button>
          </form>
          {chart.canManageDiagnosisCatalog && <details className="chart-catalog-editor">
            <summary>Add a diagnosis to the clinic catalog</summary>
            <form className="clinical-form clinical-subform" onSubmit={saveDiagnosisCatalogEntry}>
              <Field label="Diagnosis name"><input name="catalogName" maxLength={200} required /></Field>
              <div className="clinical-grid">
                <Field label="Code (optional)"><input name="catalogCode" maxLength={50} /></Field>
                <Field label="Code system (optional)"><input name="catalogCodeSystem" maxLength={40} placeholder="e.g. ICD-10" /></Field>
                <Field label="Category"><select name="catalogCategory" defaultValue="dental">
                  <option value="general_medical">General medical</option><option value="dental">Dental</option><option value="periodontal">Periodontal</option><option value="oral_surgery">Oral surgery</option><option value="restorative">Restorative</option><option value="endodontic">Endodontic</option><option value="orthodontic">Orthodontic</option><option value="prosthodontic">Prosthodontic</option><option value="other">Other</option>
                </select></Field>
                <Field label="Anatomical area (optional)"><input name="catalogArea" maxLength={200} /></Field>
              </div>
              <Field label="Catalog description"><textarea name="catalogDescription" rows={2} maxLength={1500} /></Field>
              <label className="clinical-check"><input name="catalogRequiresTooth" type="checkbox" /> This diagnosis requires a tooth location</label>
              <button className="secondary-button" disabled={saving}>{saving ? 'Saving catalog entry…' : 'Save catalog entry'}</button>
            </form>
          </details>}
          {visibleDiagnoses.length > 0 && <div className="chart-diagnosis-list">{visibleDiagnoses.map((diagnosis) => (
            <article key={diagnosis.id}>
              <strong>{diagnosis.diagnosisName}</strong>
              {diagnosis.diagnosisCode && <span>{diagnosis.diagnosisCode}{diagnosis.diagnosisCodeSystem ? ` · ${diagnosis.diagnosisCodeSystem}` : ''}</span>}
              <small>{diagnosis.category.replaceAll('_', ' ')} · {diagnosis.status.replaceAll('_', ' ')} · {diagnosis.certainty} · {diagnosis.priority}{diagnosis.severity ? ` · ${diagnosis.severity}` : ''} · recorded {dateTime(diagnosis.diagnosedAt)}</small>
              {!diagnosis.catalogEntryId && <small>Manually entered; not part of the clinic catalog.</small>}
              {chart.diagnosisCaseDecisions.filter((decision) => decision.diagnosisId === diagnosis.id).map((decision) => (
                <small key={`${decision.diagnosisId}-${decision.recordedAt}`}>
                  Case: {decision.selectedCaseType.replaceAll('_', ' ')}
                  {decision.overrideReason && ` · Clinical justification: ${decision.overrideReason}`}
                </small>
              ))}
              {diagnosis.description && <p>{diagnosis.description}</p>}
              {diagnosis.diagnosticReasoning && <p>Reasoning: {diagnosis.diagnosticReasoning}</p>}
              {diagnosis.supportingFindings && <p>Findings: {diagnosis.supportingFindings}</p>}
              {diagnosis.conflictingFindings && <p>Conflicting findings: {diagnosis.conflictingFindings}</p>}
              {diagnosis.requiredInvestigations && <p>Investigations: {diagnosis.requiredInvestigations}</p>}
              {diagnosis.priorityReason && <p>Priority rationale: {diagnosis.priorityReason}</p>}
              {diagnosis.clinicalNotes && <p>Clinical notes: {diagnosis.clinicalNotes}</p>}
              {diagnosis.locations.length > 0 && <small>{diagnosis.locations.map((location) => location.toothNumber
                ? `Tooth ${location.toothNumber} · ${location.toothSurface?.replaceAll('_', ' ')}${location.anatomicalArea ? ` · ${location.anatomicalArea}` : ''}`
                : location.anatomicalArea).filter(Boolean).join('; ')}</small>}
              {chart.diagnosisAssessments.filter((assessment) => assessment.diagnosisId === diagnosis.id).length > 0 && <div className="chart-timeline">
                {chart.diagnosisAssessments.filter((assessment) => assessment.diagnosisId === diagnosis.id).map((assessment) => (
                  <p key={assessment.id}>
                    <strong>Reassessment · {assessment.progression.replaceAll('_', ' ')}</strong>
                    <small>{dateTime(assessment.assessedAt)} · {assessment.status.replaceAll('_', ' ')} · {assessment.certainty} · {assessment.priority}</small>
                    <span>{assessment.assessmentReason}</span>
                  </p>
                ))}
              </div>}
              {chart.clinicalOutcomes.filter((outcome) => outcome.diagnosisId === diagnosis.id).map((outcome) => (
                <p key={outcome.id}>
                  <strong>Outcome · {outcome.outcome.replaceAll('_', ' ')}</strong>
                  <small>{dateTime(outcome.assessedAt)}</small>
                  <span>{outcome.clinicalFindings}</span>
                  {outcome.complications && <span>Complications: {outcome.complications}</span>}
                  {outcome.furtherTreatmentRequired && <span>Further treatment: {outcome.furtherTreatmentRequired}</span>}
                </p>
              ))}
              {diagnosis.status !== 'entered_in_error' && <details className="clinical-details">
                <summary>Reassess diagnosis</summary>
                <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
                  recordDiagnosisReassessment({
                    diagnosisId: diagnosis.id,
                    visitId: selectedVisit.id,
                    status: String(form.get('reassessmentStatus') ?? diagnosis.status),
                    certainty: String(form.get('reassessmentCertainty') ?? diagnosis.certainty),
                    priority: String(form.get('reassessmentPriority') ?? diagnosis.priority),
                    severity: String(form.get('reassessmentSeverity') ?? diagnosis.severity ?? ''),
                    progression: String(form.get('reassessmentProgression') ?? 'undetermined'),
                    reason: String(form.get('reassessmentReason') ?? ''),
                    supportingFindings: String(form.get('reassessmentFindings') ?? ''),
                    conflictingFindings: String(form.get('reassessmentConflictingFindings') ?? ''),
                    requiredInvestigations: String(form.get('reassessmentInvestigations') ?? ''),
                    priorityReason: String(form.get('reassessmentPriorityReason') ?? ''),
                  }), 'Diagnosis reassessment saved.')}>
                  <div className="clinical-grid">
                    <Field label="Status"><select name="reassessmentStatus" defaultValue={diagnosis.status}>
                      <option value="active">Active</option><option value="under_treatment">Under treatment</option><option value="resolved">Resolved</option><option value="historical">Historical</option><option value="ruled_out">Ruled out</option><option value="entered_in_error">Entered in error</option>
                    </select></Field>
                    <Field label="Certainty"><select name="reassessmentCertainty" defaultValue={diagnosis.certainty}>
                      <option value="suspected">Suspected</option><option value="provisional">Provisional</option><option value="confirmed">Confirmed</option><option value="differential">Differential</option>
                    </select></Field>
                    <Field label="Priority"><select name="reassessmentPriority" defaultValue={diagnosis.priority}>
                      <option value="routine">Routine</option><option value="priority">Priority</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
                    </select></Field>
                    <Field label="Severity"><select name="reassessmentSeverity" defaultValue={diagnosis.severity ?? 'unspecified'}>
                      <option value="unspecified">Unspecified</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option><option value="critical">Critical</option>
                    </select></Field>
                    <Field label="Progression"><select name="reassessmentProgression" defaultValue="undetermined">
                      <option value="improved">Improved</option><option value="worsened">Worsened</option><option value="unchanged">Unchanged</option><option value="resolved">Resolved</option><option value="recurrence">Recurrence</option><option value="complicated">Complicated</option><option value="undetermined">Undetermined</option>
                    </select></Field>
                  </div>
                  <Field label="Reason for reassessment"><textarea name="reassessmentReason" rows={2} maxLength={2000} required /></Field>
                  <Field label="New supporting findings"><textarea name="reassessmentFindings" rows={2} maxLength={2000} /></Field>
                  <Field label="Conflicting findings"><textarea name="reassessmentConflictingFindings" rows={2} maxLength={2000} /></Field>
                  <Field label="Required investigations"><textarea name="reassessmentInvestigations" rows={2} maxLength={2000} /></Field>
                  <Field label="Reason for changing priority (required if priority changes)"><textarea name="reassessmentPriorityReason" rows={2} maxLength={1000} /></Field>
                  <button className="secondary-button" disabled={saving}>Save reassessment</button>
                </form>
              </details>}
              {diagnosis.status !== 'entered_in_error' && <details className="clinical-details">
                <summary>Record clinical outcome</summary>
                <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
                  recordClinicalOutcome({
                    diagnosisId: diagnosis.id,
                    visitId: selectedVisit.id,
                    assessmentId: String(form.get('outcomeAssessment') ?? ''),
                    procedureId: String(form.get('outcomeProcedure') ?? ''),
                    outcome: String(form.get('clinicalOutcome') ?? 'undetermined'),
                    clinicalFindings: String(form.get('outcomeFindings') ?? ''),
                    complications: String(form.get('outcomeComplications') ?? ''),
                    furtherTreatmentRequired: String(form.get('outcomeFurtherTreatment') ?? ''),
                  }), 'Clinical outcome recorded.')}>
                  <Field label="Outcome"><select name="clinicalOutcome" defaultValue="undetermined">
                    <option value="improved">Improved</option><option value="worsened">Worsened</option><option value="unchanged">Unchanged</option><option value="resolved">Resolved</option><option value="recurrence">Recurrence</option><option value="complicated">Complicated</option><option value="undetermined">Undetermined</option>
                  </select></Field>
                  <Field label="Related reassessment (optional)"><select name="outcomeAssessment" defaultValue="">
                    <option value="">None</option>{chart.diagnosisAssessments.filter((assessment) => assessment.diagnosisId === diagnosis.id && assessment.visitId === selectedVisit.id).map((assessment) => (
                      <option key={assessment.id} value={assessment.id}>{dateTime(assessment.assessedAt)} · {assessment.progression.replaceAll('_', ' ')}</option>
                    ))}
                  </select></Field>
                  <Field label="Related procedure (optional)"><select name="outcomeProcedure" defaultValue="">
                    <option value="">None</option>{chart.procedures.map((procedure) => (
                      <option key={procedure.id} value={procedure.id}>{procedure.procedureName} · {dateTime(procedure.performedAt)}</option>
                    ))}
                  </select></Field>
                  <Field label="Clinical findings"><textarea name="outcomeFindings" rows={2} maxLength={2000} required /></Field>
                  <Field label="Complications (optional)"><textarea name="outcomeComplications" rows={2} maxLength={2000} /></Field>
                  <Field label="Further treatment required (optional)"><textarea name="outcomeFurtherTreatment" rows={2} maxLength={2000} /></Field>
                  <button className="secondary-button" disabled={saving}>Save clinical outcome</button>
                </form>
              </details>}
            </article>
          ))}</div>}
          {chart.canReviewDiagnosisCatalogProposals && chart.diagnosisCatalogProposals.length > 0 && <section className="chart-panel">
            <h3>Diagnosis catalog proposals</h3>
            <p className="workspace-help-copy">Reviewing a proposal affects the shared clinic catalog only; it does not approve or change the patient-specific diagnosis.</p>
            <Field label="Search clinic catalog for an entry to merge into">
              <input value={proposalCatalogSearch} onChange={(event) => setProposalCatalogSearch(event.target.value)} maxLength={100} />
            </Field>
            <button type="button" className="secondary-button" disabled={saving || proposalCatalogSearch.trim().length < 2} onClick={() => void searchProposalCatalog()}>
              Search catalog
            </button>
            {proposalCatalogResults.length > 0 && <div className="chart-visit-list" role="list">
              {proposalCatalogResults.map((entry) => (
                <p key={entry.id}><strong>{entry.diagnosisName}</strong> · {entry.category.replaceAll('_', ' ')}{entry.diagnosisCode ? ` · ${entry.diagnosisCode}` : ''}</p>
              ))}
            </div>}
            {chart.diagnosisCatalogProposals.map((proposal) => (
              <article className="chart-record-card" key={proposal.id}>
                <strong>{proposal.diagnosisName}</strong>
                <small>{proposal.category.replaceAll('_', ' ')} · proposed {dateTime(proposal.submittedAt)}</small>
                {proposal.diagnosisCode && <small>{proposal.diagnosisCode}{proposal.codeSystem ? ` · ${proposal.codeSystem}` : ''}</small>}
                {proposal.description && <p>{proposal.description}</p>}
                <form className="clinical-form clinical-subform" onSubmit={(event) => void submitProposalReview(event, proposal.id)}>
                  <Field label="Review decision"><select name="proposalDecision" defaultValue="approved">
                    <option value="approved">Approve into clinic catalog</option>
                    <option value="merged">Merge with an existing catalog entry</option>
                    <option value="clarification_requested">Request clarification</option>
                    <option value="rejected">Reject proposal</option>
                  </select></Field>
                  <div className="clinical-grid">
                    <Field label="Catalog diagnosis name"><input name="proposalName" defaultValue={proposal.diagnosisName} maxLength={200} /></Field>
                    <Field label="Code"><input name="proposalCode" defaultValue={proposal.diagnosisCode ?? ''} maxLength={50} /></Field>
                    <Field label="Code system"><input name="proposalCodeSystem" defaultValue={proposal.codeSystem ?? ''} maxLength={40} /></Field>
                    <Field label="Category"><select name="proposalCategory" defaultValue={proposal.category}>
                      <option value="general_medical">General medical</option><option value="dental">Dental</option><option value="periodontal">Periodontal</option><option value="oral_surgery">Oral surgery</option><option value="restorative">Restorative</option><option value="endodontic">Endodontic</option><option value="orthodontic">Orthodontic</option><option value="prosthodontic">Prosthodontic</option><option value="other">Other</option>
                    </select></Field>
                    <Field label="Existing catalog entry for merge">
                      <select name="proposalCatalogEntry" defaultValue="">
                        <option value="">Choose a searched entry</option>
                        {proposalCatalogResults.map((entry) => (
                          <option key={entry.id} value={entry.id}>{entry.diagnosisName} · {entry.category.replaceAll('_', ' ')}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Reviewer notes (required)"><textarea name="proposalNotes" rows={2} maxLength={2000} required /></Field>
                  <button className="secondary-button" disabled={saving}>Record review</button>
                </form>
              </article>
            ))}
          </section>}
        </article>}
        <ClinicalRecordReview
          records={chart.clinicalRecords}
          canReview={chart.canReviewClinicalRecords}
          canReviewEscalated={chart.canReviewEscalatedClinicalRecords}
          selectedId={reviewRecordId}
          onSelect={setReviewRecordId}
          saving={saving}
          onSubmitDraft={async (recordId) => {
            setSaving(true)
            setFormError('')
            setNotice('')
            try {
              const result = await submitClinicalRecord(recordId)
              if (!result.ok) {
                setFormError(result.error)
                return
              }
              await reload()
              setNotice('Clinical record submitted for review.')
            } catch (error) {
              setFormError(error instanceof Error ? error.message : 'Record could not be submitted.')
            } finally {
              setSaving(false)
            }
          }}
          onSubmit={async (recordId, decision, comment) => {
            setSaving(true)
            setFormError('')
            setNotice('')
            try {
              const result = await reviewClinicalRecord(recordId, decision, comment)
              if (!result.ok) {
                setFormError(result.error)
                return
              }
              setReviewRecordId('')
              await reload()
              setNotice(`Clinical record ${decision}.`)
            } catch (error) {
              setFormError(error instanceof Error ? error.message : 'Review could not be saved.')
            } finally {
              setSaving(false)
            }
          }}
          onResubmit={async (recordId, correctionReason, correctedRecord) => {
            setSaving(true)
            setFormError('')
            setNotice('')
            try {
              const result = await submitClinicalRecord(recordId, correctionReason, correctedRecord)
              if (!result.ok) {
                setFormError(result.error)
                return false
              }
              await reload()
              setNotice('Corrected clinical record resubmitted for review.')
              return true
            } catch (error) {
              setFormError(error instanceof Error ? error.message : 'Record could not be resubmitted.')
              return false
            } finally {
              setSaving(false)
            }
          }}
        />
      </div>
    </div>}

    {section === 'dental' && <div className="chart-content-grid">
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Interactive odontogram</h2><p>Select a tooth, record a surface and a finding. Tooth numbering follows FDI.</p></div></div>
        <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
          setPreferredDentalNotation(String(form.get('dentalNotation') ?? 'fdi') as 'fdi' | 'universal' | 'palmer'),
        'Dental numbering preference updated.')}>
          <Field label="My tooth display notation">
            <select name="dentalNotation" defaultValue={chart.preferredDentalNotation}>
              <option value="fdi">FDI</option>
              <option value="universal">Universal</option>
              <option value="palmer">Palmer</option>
            </select>
          </Field>
          <button className="secondary-button" disabled={saving}>Save display preference</button>
        </form>
        <p className="workspace-help-copy">The chart stores anatomical tooth identity internally. The selected notation only changes display.</p>
        <div className="odontogram-legend"><span><i className="tooth-dot tooth-existing" /> Existing</span><span><i className="tooth-dot tooth-proposed" /> Proposed</span><span><i className="tooth-dot tooth-progress" /> In progress</span><span><i className="tooth-dot tooth-completed" /> Completed</span></div>
        <p className="odontogram-label">Permanent teeth</p>
        <div className="odontogram-grid odontogram-permanent">{permanentTeeth.map((tooth) => (
          <ToothButton key={tooth} tooth={tooth} findings={chart.odontogram} selected={selectedTooth === tooth} onSelect={setSelectedTooth} />
        ))}</div>
        <p className="odontogram-label">Primary teeth</p>
        <div className="odontogram-grid odontogram-primary">{primaryTeeth.map((tooth) => (
          <ToothButton key={tooth} tooth={tooth} findings={chart.odontogram} selected={selectedTooth === tooth} onSelect={setSelectedTooth} />
        ))}</div>
        <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
          addOdontogramFinding({
            patientId,
            visitId: String(form.get('odontogramVisit') ?? ''),
            performedProcedureId: String(form.get('procedureId') ?? ''),
            toothNumber: selectedTooth || String(form.get('toothNumber') ?? ''),
            surface: String(form.get('surface') ?? ''),
            finding: String(form.get('finding') ?? ''),
            stage: String(form.get('stage') ?? ''),
            notes: String(form.get('notes') ?? ''),
          }), `Finding recorded for tooth ${selectedTooth || 'selected'}.`)}>
          <h3>{selectedTooth ? `Record a finding for tooth ${selectedTooth}` : 'Record a tooth finding'}</h3>
          {!selectedTooth && <Field label="FDI tooth number"><input name="toothNumber" inputMode="numeric" pattern="(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])" maxLength={2} required /></Field>}
          <div className="clinical-grid">
            <Field label="Surface"><select name="surface"><option value="whole_tooth">Whole tooth</option><option value="mesial">Mesial</option><option value="distal">Distal</option><option value="occlusal">Occlusal</option><option value="buccal">Buccal</option><option value="lingual_palatal">Lingual / palatal</option></select></Field>
            <Field label="Finding"><select name="finding" required><option value="">Select finding</option><option value="caries">Caries</option><option value="filling">Filling / restoration</option><option value="missing">Missing</option><option value="extracted">Extracted</option><option value="root_canal">Root canal</option><option value="crown">Crown</option><option value="bridge">Bridge</option><option value="implant">Implant</option><option value="fracture">Fracture</option><option value="mobility">Mobility</option><option value="periodontal">Periodontal condition</option><option value="other">Other finding</option></select></Field>
            <Field label="Clinical stage"><select name="stage"><option value="existing">Existing finding</option><option value="proposed">Proposed treatment</option><option value="in_progress">In progress</option><option value="completed">Completed treatment</option></select></Field>
            <Field label="Link to visit"><select name="odontogramVisit" defaultValue={selectedVisitId}><option value="">Patient chart only</option>{chart.visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.visitNumber} · {new Date(visit.visitedAt).toLocaleDateString()}</option>)}</select></Field>
            <Field label="Actual procedure (required for completed treatment)"><select name="procedureId"><option value="">No completed procedure</option>{chart.procedures.map((procedure) => <option key={procedure.id} value={procedure.id}>{procedure.procedureName} · {procedure.toothNumbers.join(', ')}</option>)}</select></Field>
          </div>
          <Field label="Notes"><textarea name="notes" rows={2} maxLength={1500} /></Field>
          <button className="primary-button" disabled={saving}><Plus /> Save finding</button>
        </form>
      </article>
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Tooth history</h2><p>All findings remain visible in chronological order.</p></div></div>
        {chart.odontogram.length ? <div className="chart-timeline">{chart.odontogram.map((item) => (
          <article className="chart-history-entry" key={item.id}>
            <span className={`chart-entry-tag chart-stage-${item.stage}`}>Tooth {item.toothNumber} · {item.toothSurface.replaceAll('_', ' ')}</span>
            <p>{item.finding.replaceAll('_', ' ')}</p>
            <small>{item.stage.replaceAll('_', ' ')} · {dateTime(item.recordedAt)}{item.notes ? ` · ${item.notes}` : ''}</small>
          </article>
        ))}</div> : <p className="chart-empty">No dental findings have been recorded yet.</p>}
      </article>
    </div>}

    {section === 'treatments' && <div className="chart-content-grid">
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Create a treatment plan</h2><p>Plan and actual procedures are separate records. Proposed work is never shown as completed.</p></div></div>
        <form className="clinical-form" onSubmit={(event) => handleSubmit(event, async (form) => {
          const toothNumbers = String(form.get('planTeeth') ?? '').split(',').map((tooth) => tooth.trim()).filter(Boolean)
          const result = await createClinicTreatmentPlan({
            patientId,
            branchId,
            visitId: String(form.get('planVisit') ?? ''),
            title: String(form.get('planTitle') ?? ''),
            treatmentName: String(form.get('treatmentName') ?? ''),
            toothNumbers,
            description: String(form.get('planDescription') ?? ''),
            clinicalReason: String(form.get('clinicalReason') ?? ''),
            estimatedCost: String(form.get('estimatedCost') ?? ''),
            estimatedDurationMinutes: String(form.get('duration') ?? ''),
            priority: String(form.get('priority') ?? 'routine'),
          })
          return result
        }, 'Treatment plan and proposed item created.')}>
          <Field label="Plan title"><input name="planTitle" maxLength={160} required /></Field>
          <Field label="Treatment / procedure"><input name="treatmentName" maxLength={160} required placeholder="e.g. Restore tooth" /></Field>
          <div className="clinical-grid">
            <Field label="Related FDI teeth (comma separated)"><input name="planTeeth" placeholder="e.g. 16, 17" /></Field>
            <Field label="Priority"><select name="priority"><option value="routine">Routine</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field>
            <Field label="Estimated cost"><input name="estimatedCost" type="number" min="0" step="0.01" inputMode="decimal" /></Field>
            <Field label="Estimated duration (minutes)"><input name="duration" type="number" min="1" inputMode="numeric" /></Field>
          </div>
          <Field label="Clinical reason"><textarea name="clinicalReason" rows={2} maxLength={1500} /></Field>
          <Field label="Description"><textarea name="planDescription" rows={2} maxLength={1500} /></Field>
          <Field label="Related visit"><select name="planVisit" defaultValue={selectedVisitId}><option value="">No visit linked</option>{chart.visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.visitNumber} · {new Date(visit.visitedAt).toLocaleDateString()}</option>)}</select></Field>
          <button className="primary-button" disabled={saving}><Plus /> Create proposed plan</button>
        </form>
        <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
          addTreatmentPlanStage({
            planId: String(form.get('stagePlan') ?? ''),
            stageName: String(form.get('stageName') ?? ''),
            stageDescription: String(form.get('stageDescription') ?? ''),
            sequenceNumber: Number(form.get('stageSequence') ?? '1'),
            expectedStartDate: String(form.get('stageStart') ?? ''),
            expectedCompletionDate: String(form.get('stageCompletion') ?? ''),
            estimatedDuration: String(form.get('stageDuration') ?? ''),
            completionCriteria: String(form.get('stageCriteria') ?? ''),
            requiredMaterials: [],
          }), 'Treatment stage added.')}>
          <h3>Add stage</h3>
          <Field label="Treatment plan"><select name="stagePlan" required><option value="">Select plan</option>{chart.treatmentPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></Field>
          <div className="clinical-grid">
            <Field label="Stage name"><input name="stageName" required maxLength={200} /></Field>
            <Field label="Sequence"><input name="stageSequence" type="number" min="1" defaultValue="1" required /></Field>
          </div>
          <Field label="Stage description"><textarea name="stageDescription" rows={2} maxLength={1500} /></Field>
          <div className="clinical-grid">
            <Field label="Expected start"><input name="stageStart" type="date" /></Field>
            <Field label="Expected completion"><input name="stageCompletion" type="date" /></Field>
            <Field label="Estimated duration"><input name="stageDuration" maxLength={100} placeholder="e.g. 6 months" /></Field>
          </div>
          <Field label="Completion criteria"><textarea name="stageCriteria" rows={2} maxLength={1500} /></Field>
          <button className="secondary-button" disabled={saving}><Plus /> Add stage</button>
        </form>
        <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) => {
          const toothIdentity = String(form.get('stepTeeth') ?? '').split(',').map((tooth) => tooth.trim()).filter(Boolean)
          const duration = String(form.get('stepDuration') ?? '').trim()
          const appointment = String(form.get('stepAppointment') ?? '').trim()
          const interval = String(form.get('stepInterval') ?? '').trim()
          return addTreatmentPlanStep({
            stageId: String(form.get('stepStage') ?? ''),
            stepDescription: String(form.get('stepDescription') ?? ''),
            sequenceNumber: Number(form.get('stepSequence') ?? '1'),
            procedureName: String(form.get('stepProcedure') ?? ''),
            toothIdentity,
            estimatedDurationMinutes: duration ? Number(duration) : null,
            appointmentMinutes: appointment ? Number(appointment) : null,
            recommendedDate: String(form.get('stepDate') ?? ''),
            recommendedIntervalDays: interval ? Number(interval) : null,
            clinicalInstructions: String(form.get('stepInstructions') ?? ''),
          })
        }, 'Treatment step added.')}>
          <h3>Add treatment step</h3>
          <Field label="Stage"><select name="stepStage" required><option value="">Select stage</option>{chart.treatmentStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.stageName}</option>)}</select></Field>
          <Field label="Step description"><textarea name="stepDescription" rows={2} maxLength={1000} required /></Field>
          <div className="clinical-grid">
            <Field label="Sequence"><input name="stepSequence" type="number" min="1" defaultValue="1" required /></Field>
            <Field label="Procedure"><input name="stepProcedure" maxLength={200} /></Field>
            <Field label="FDI teeth"><input name="stepTeeth" placeholder="e.g. 16, 17" /></Field>
            <Field label="Procedure minutes"><input name="stepDuration" type="number" min="1" /></Field>
            <Field label="Appointment minutes"><input name="stepAppointment" type="number" min="1" /></Field>
            <Field label="Recommended date"><input name="stepDate" type="date" /></Field>
            <Field label="Interval (days)"><input name="stepInterval" type="number" min="0" /></Field>
          </div>
          <Field label="Clinical instructions"><textarea name="stepInstructions" rows={2} maxLength={2000} /></Field>
          <button className="secondary-button" disabled={saving}><Plus /> Add step</button>
        </form>
        <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
          createAppointmentRecommendation({
            patientId,
            branchId,
            planId: String(form.get('recommendationPlan') ?? ''),
            stageId: String(form.get('recommendationStage') ?? ''),
            stepId: String(form.get('recommendationStep') ?? ''),
            assignedDoctorId: String(form.get('recommendationDoctor') ?? ''),
            proposedStart: String(form.get('recommendationStart') ?? ''),
            proposedEnd: String(form.get('recommendationEnd') ?? ''),
            room: String(form.get('recommendationRoom') ?? ''),
            equipment: [],
          }), 'Appointment recommendation created.')}>
          <h3>Recommend appointment</h3>
          <div className="clinical-grid">
            <Field label="Plan"><select name="recommendationPlan"><option value="">No plan</option>{chart.treatmentPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></Field>
            <Field label="Stage"><select name="recommendationStage"><option value="">No stage</option>{chart.treatmentStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.stageName}</option>)}</select></Field>
            <Field label="Step"><select name="recommendationStep"><option value="">No step</option>{chart.treatmentSteps.map((step) => <option key={step.id} value={step.id}>{step.stepDescription}</option>)}</select></Field>
            <Field label="Doctor ID"><input name="recommendationDoctor" required /></Field>
            <Field label="Start"><input name="recommendationStart" type="datetime-local" required /></Field>
            <Field label="End"><input name="recommendationEnd" type="datetime-local" required /></Field>
            <Field label="Treatment room"><input name="recommendationRoom" /></Field>
          </div>
          <button className="secondary-button" disabled={saving}><Plus /> Create recommendation</button>
        </form>
        {chart.appointmentRecommendations.length > 0 && <div className="chart-timeline">{chart.appointmentRecommendations.map((recommendation) => (
          <article className="chart-history-entry" key={recommendation.id}>
            <span className="chart-entry-tag">{recommendation.status}</span>
            <p>{dateTime(recommendation.proposedStart)} to {dateTime(recommendation.proposedEnd)}</p>
            {recommendation.status === 'proposed' && <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
              acceptAppointmentRecommendation({
                recommendationId: recommendation.id,
                proposedStart: String(form.get('acceptStart') ?? ''),
                proposedEnd: String(form.get('acceptEnd') ?? ''),
                assignedDoctorId: String(form.get('acceptDoctor') ?? ''),
                overrideReason: String(form.get('overrideReason') ?? ''),
              }), 'Appointment scheduled.')}>
              <div className="clinical-grid">
                <Field label="Confirmed start"><input name="acceptStart" type="datetime-local" required defaultValue={recommendation.proposedStart.slice(0, 16)} /></Field>
                <Field label="Confirmed end"><input name="acceptEnd" type="datetime-local" required defaultValue={recommendation.proposedEnd.slice(0, 16)} /></Field>
                <Field label="Doctor ID"><input name="acceptDoctor" required /></Field>
              </div>
              <Field label="Override reason (required only for conflicts)"><input name="overrideReason" maxLength={2000} /></Field>
              <button className="secondary-button" disabled={saving}>Accept and schedule</button>
            </form>}
          </article>
        ))}</div>}
      </article>

      <div className="chart-stack">
        <article className="panel chart-panel">
          <div className="panel-header"><div><h2>Treatment plans</h2><p>Patient authorization and clinical approval are tracked separately.</p></div></div>
          {chart.treatmentPlans.length ? <div className="chart-timeline">{chart.treatmentPlans.map((plan) => (
            <article className="chart-history-entry" key={plan.id}>
              <span className={`chart-entry-tag chart-stage-${plan.status}`}>{plan.title} · {plan.status.replaceAll('_', ' ')}</span>
              {plan.items.map((item) => <div className="chart-treatment-item" key={item.id}>
                <p><strong>{item.treatmentName}</strong> · {item.toothNumbers.join(', ') || 'No tooth linked'} · {item.status.replaceAll('_', ' ')}{item.estimatedCost === null ? '' : ` · ${item.estimatedCost}`}</p>
                {nextTreatmentStatuses(item.status).map((nextStatus) => (
                  <button
                    className="row-action"
                    key={nextStatus}
                    disabled={saving || updatingTreatmentId === item.id}
                    onClick={() => void changeTreatmentItemStatus(item.id, nextStatus)}
                  >{updatingTreatmentId === item.id ? 'Saving…' : treatmentActionLabel(nextStatus)}</button>
                ))}
              </div>)}
              {chart.treatmentStages.filter((stage) => stage.planId === plan.id).map((stage) => (
                <div className="chart-treatment-item" key={stage.id}>
                  <p><strong>Stage {stage.sequenceNumber}: {stage.stageName}</strong> · {stage.status.replaceAll('_', ' ')}</p>
                  {stage.stageDescription && <small>{stage.stageDescription}</small>}
                  {stage.expectedStartDate && <small>Expected {stage.expectedStartDate}{stage.expectedCompletionDate ? ` to ${stage.expectedCompletionDate}` : ''}</small>}
                  {chart.treatmentSteps.filter((step) => step.stageId === stage.id).map((step) => (
                    <span key={step.id}>{step.sequenceNumber}. {step.stepDescription}{step.appointmentMinutes ? ` · ${step.appointmentMinutes} min` : ''}</span>
                  ))}
                </div>
              ))}
              <small>{dateTime(plan.createdAt)}</small>
            </article>
          ))}</div> : <p className="chart-empty">No treatment plans yet.</p>}
        </article>
        <article className="panel chart-panel">
          <div className="panel-header"><div><h2>Record completed procedure</h2><p>Only enter work that has actually been performed.</p></div></div>
          <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
            recordPerformedProcedure({
              patientId,
              branchId,
              visitId: String(form.get('procedureVisit') ?? ''),
              treatmentPlanItemId: String(form.get('procedurePlanItem') ?? ''),
              procedureName: String(form.get('procedureName') ?? ''),
              toothNumbers: String(form.get('procedureTeeth') ?? '').split(',').map((tooth) => tooth.trim()).filter(Boolean),
              details: String(form.get('procedureDetails') ?? ''),
              clinicalOutcome: String(form.get('clinicalOutcome') ?? ''),
            }), 'Performed procedure recorded in the patient history.')}>
            <Field label="Procedure name"><input name="procedureName" maxLength={160} required /></Field>
            <Field label="Linked treatment item"><select name="procedurePlanItem"><option value="">Not linked to a plan item</option>{chart.treatmentPlans.flatMap((plan) => plan.items.map((item) => <option key={item.id} value={item.id}>{plan.title} · {item.treatmentName}</option>))}</select></Field>
            <div className="clinical-grid">
              <Field label="FDI teeth"><input name="procedureTeeth" placeholder="e.g. 16, 17" /></Field>
              <Field label="Related visit"><select name="procedureVisit"><option value="">No visit linked</option>{chart.visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.visitNumber}</option>)}</select></Field>
            </div>
            <Field label="Procedure details"><textarea name="procedureDetails" rows={2} maxLength={3000} required /></Field>
            <Field label="Clinical outcome"><textarea name="clinicalOutcome" rows={2} maxLength={1500} /></Field>
            <button className="secondary-button" disabled={saving}><Check /> Record performed procedure</button>
          </form>
        </article>
        <article className="panel chart-panel">
          <div className="panel-header"><div><h2>Prescriptions</h2><p>Prescribed medication is kept distinct from dispensed or administered medication.</p></div></div>
          <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
            createClinicPrescription({
              patientId,
              visitId: String(form.get('prescriptionVisit') ?? ''),
              medicationName: String(form.get('medicationName') ?? ''),
              strength: String(form.get('strength') ?? ''),
              dosage: String(form.get('dosage') ?? ''),
              route: String(form.get('route') ?? ''),
              frequency: String(form.get('frequency') ?? ''),
              duration: String(form.get('durationText') ?? ''),
              quantity: String(form.get('quantity') ?? ''),
              instructions: String(form.get('instructions') ?? ''),
            }), 'Prescription saved.')}>
            <Field label="Medication"><input name="medicationName" maxLength={160} required /></Field>
            <div className="clinical-grid">
              <Field label="Strength"><input name="strength" maxLength={100} /></Field>
              <Field label="Dosage"><input name="dosage" maxLength={100} required /></Field>
              <Field label="Route"><input name="route" maxLength={80} required placeholder="e.g. oral" /></Field>
              <Field label="Frequency"><input name="frequency" maxLength={120} required /></Field>
              <Field label="Duration"><input name="durationText" maxLength={100} /></Field>
              <Field label="Quantity"><input name="quantity" maxLength={80} /></Field>
            </div>
            <Field label="Instructions"><textarea name="instructions" rows={2} maxLength={1500} /></Field>
            <Field label="Related visit"><select name="prescriptionVisit"><option value="">No visit linked</option>{chart.visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.visitNumber}</option>)}</select></Field>
            <button className="secondary-button" disabled={saving}><Plus /> Save prescription</button>
          </form>
          {chart.prescriptions.map((prescription) => <div className="chart-prescription-row" key={prescription.id}>
            <strong>{prescription.medicationName}{prescription.strength ? ` · ${prescription.strength}` : ''}</strong>
            <span>{prescription.dosage} · {prescription.route} · {prescription.frequency}{prescription.duration ? ` · ${prescription.duration}` : ''}</span>
            {prescription.instructions && <small>{prescription.instructions}</small>}
          </div>)}
        </article>
        <article className="panel chart-panel">
          <div className="panel-header"><div><h2>Treatment consent</h2><p>This consent is separate from permission to share a patient’s information with another clinic.</p></div></div>
          <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
            recordPatientConsent({
              patientId,
              visitId: String(form.get('consentVisit') ?? ''),
              treatmentPlanItemId: String(form.get('consentPlanItem') ?? ''),
              status: String(form.get('consentStatus') ?? 'given') as 'given' | 'refused' | 'withdrawn',
              method: String(form.get('consentMethod') ?? ''),
              notes: String(form.get('consentNotes') ?? ''),
              attachmentId: String(form.get('consentAttachment') ?? ''),
            }), 'Consent event added to the patient record.')}>
            <div className="clinical-grid">
              <Field label="Consent status"><select name="consentStatus"><option value="given">Given</option><option value="refused">Refused</option><option value="withdrawn">Withdrawn</option></select></Field>
              <Field label="Method"><select name="consentMethod"><option value="verbal">Verbal</option><option value="written">Written</option><option value="electronic">Electronic</option><option value="other">Other</option></select></Field>
            </div>
            <Field label="Notes"><textarea name="consentNotes" rows={2} maxLength={1500} /></Field>
            <Field label="Related visit"><select name="consentVisit"><option value="">No visit linked</option>{chart.visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.visitNumber}</option>)}</select></Field>
            <Field label="Related treatment plan item"><select name="consentPlanItem"><option value="">No treatment item linked</option>{chart.treatmentPlans.flatMap((plan) => plan.items.map((item) => <option key={item.id} value={item.id}>{plan.title} · {item.treatmentName}</option>))}</select></Field>
            <Field label="Supporting consent document"><select name="consentAttachment"><option value="">No file attached</option>{chart.attachments.filter((attachment) => attachment.category === 'consent').map((attachment) => <option key={attachment.id} value={attachment.id}>{attachment.fileName}</option>)}</select></Field>
            <button className="secondary-button" disabled={saving}><Plus /> Record consent event</button>
          </form>
          {chart.consents.map((consent) => <div className="chart-prescription-row" key={consent.id}>
            <strong>{consent.status.replaceAll('_', ' ')} · {consent.method.replaceAll('_', ' ')}</strong>
            <span>{consent.notes || 'No additional notes'} · {dateTime(consent.recordedAt)}</span>
          </div>)}
        </article>
        <article className="panel chart-panel">
          <div className="panel-header"><div><h2>Completed procedures</h2><p>Actual work performed and documented.</p></div></div>
          {chart.procedures.length ? chart.procedures.map((procedure) => (
            <div className="chart-prescription-row" key={procedure.id}>
              <strong>{procedure.procedureName}{procedure.toothNumbers.length ? ` · ${procedure.toothNumbers.join(', ')}` : ''}</strong>
              <span>{procedure.procedureDetails} · {dateTime(procedure.performedAt)}</span>
              {procedure.clinicalOutcome && <small>{procedure.clinicalOutcome}</small>}
            </div>
          )) : <p className="chart-empty">No procedures have been recorded as performed.</p>}
        </article>
      </div>
    </div>}

    {section === 'documents' && <div className="chart-content-grid">
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Secure clinical documents</h2><p>Files are kept in a private bucket. Access links expire after five minutes and are recorded.</p></div></div>
        <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
          createClinicalReferral({
            patientId,
            branchId,
            receivingOrganizationId: String(form.get('receivingOrganization') ?? ''),
            receivingBranchId: String(form.get('receivingBranch') ?? ''),
            receivingDoctorId: String(form.get('receivingDoctor') ?? ''),
            reason: String(form.get('referralReason') ?? ''),
            recommendedNextSteps: String(form.get('referralNextSteps') ?? ''),
          }), 'Clinical referral sent.')}>
          <h3>Refer patient</h3>
          <p className="workspace-help-copy">Enter receiving organization, branch and doctor identifiers only for clinics authorized to receive this referral.</p>
          <div className="clinical-grid">
            <Field label="Receiving organization ID"><input name="receivingOrganization" /></Field>
            <Field label="Receiving branch ID"><input name="receivingBranch" /></Field>
            <Field label="Receiving doctor ID"><input name="receivingDoctor" /></Field>
          </div>
          <Field label="Referral reason"><textarea name="referralReason" rows={2} maxLength={3000} required /></Field>
          <Field label="Recommended next steps"><textarea name="referralNextSteps" rows={2} maxLength={3000} /></Field>
          <button className="secondary-button" disabled={saving}><Stethoscope /> Send referral</button>
        </form>
        {chart.referrals.length > 0 && <div className="chart-timeline">{chart.referrals.map((referral) => (
          <article className="chart-history-entry" key={referral.id}>
            <span className="chart-entry-tag">{referral.status.replaceAll('_', ' ')}</span>
            <p>{referral.reason}</p>
            {referral.recommendedNextSteps && <small>{referral.recommendedNextSteps}</small>}
            <small>{dateTime(referral.sentAt)}</small>
          </article>
        ))}</div>}
        <form className="clinical-form" encType="multipart/form-data" onSubmit={(event) =>
          handleSubmit(event, uploadClinicalAttachment, 'Document uploaded to the private clinical file store.')}>
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="branchId" value={branchId} />
          <div className="clinical-grid">
            <Field label="Document category"><select name="category"><option value="dental_xray">Dental X-ray</option><option value="panoramic_radiograph">Panoramic radiograph</option><option value="intraoral_photo">Intraoral photograph</option><option value="clinical_photo">Clinical photograph</option><option value="laboratory_report">Laboratory report</option><option value="referral">Referral</option><option value="consent">Consent form</option><option value="treatment_document">Treatment document</option><option value="other">Other</option></select></Field>
            <Field label="Related visit"><select name="visitId"><option value="">Patient profile</option>{chart.visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.visitNumber} · {new Date(visit.visitedAt).toLocaleDateString()}</option>)}</select></Field>
          </div>
          <Field label="Related FDI tooth (optional)"><input name="toothNumber" inputMode="numeric" pattern="(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])" maxLength={2} /></Field>
          <Field label="Description"><input name="description" maxLength={500} placeholder="Briefly describe this file" /></Field>
          <Field label="File (PDF, JPEG, PNG, WebP, or DICOM; max 20 MB)"><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.dcm,application/pdf,image/jpeg,image/png,image/webp,application/dicom" required /></Field>
          <button className="primary-button" disabled={saving}><Plus /> {saving ? 'Uploading securely…' : 'Upload document'}</button>
        </form>
        <p className="workspace-help-copy">Avoid uploading identifiable clinical information to development environments. Use synthetic files while testing.</p>
      </article>
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Patient documents</h2><p>{chart.attachments.length} private file{chart.attachments.length === 1 ? '' : 's'}</p></div></div>
        {chart.attachments.length ? <div className="chart-timeline">{chart.attachments.map((attachment) => (
          <article className="chart-document-row" key={attachment.id}>
            <span className="chart-document-icon"><FileHeart /></span>
            <div className="chart-document-copy">
              <strong>{attachment.fileName}</strong>
              <span>{attachment.category.replaceAll('_', ' ')}{attachment.toothNumber ? ` · Tooth ${attachment.toothNumber}` : ''}{attachment.fileSize ? ` · ${(attachment.fileSize / (1024 * 1024)).toFixed(1)} MB` : ''}</span>
              {attachment.description && <small>{attachment.description}</small>}
              <time>{dateTime(attachment.createdAt)}</time>
            </div>
            <button className="secondary-button" disabled={openingAttachment === attachment.id} onClick={async () => {
              setOpeningAttachment(attachment.id)
              setFormError('')
              try {
                const result = await getClinicalAttachmentUrl(attachment.id)
                if (!result.ok) {
                  setFormError(result.error)
                  return
                }
                window.location.assign(result.url)
              } catch (error) {
                setFormError(error instanceof Error ? error.message : 'Document could not be opened.')
              } finally {
                setOpeningAttachment('')
              }
            }}>{openingAttachment === attachment.id ? 'Opening…' : 'Open'}</button>
          </article>
        ))}</div> : <p className="chart-empty">No documents have been uploaded to this patient chart.</p>}
      </article>
    </div>}

    {section === 'safety' && <div className="chart-content-grid">
      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Flag a clinical safety finding</h2><p>Urgency is set by an authorized clinician. This system does not determine clinical risk.</p></div><Bell /></div>
        {!chart.canCreateClinicalSafetyAlert
          ? <p className="chart-empty">Your clinic role cannot flag safety alerts.</p>
          : selectedVisit ? <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
          createClinicalSafetyAlert({
            patientId,
            visitId: String(form.get('safetyVisitId') ?? ''),
            diagnosisId: String(form.get('safetyDiagnosisId') ?? ''),
            title: String(form.get('safetyTitle') ?? ''),
            description: String(form.get('safetyDescription') ?? ''),
            criticality: String(form.get('safetyCriticality') ?? 'urgent'),
          }), 'Clinical safety alert flagged.')}>
          <input type="hidden" name="safetyVisitId" value={selectedVisit.id} />
          <div className="clinical-grid">
            <p className="workspace-help-copy">Related visit: {selectedVisit.visitNumber} · {dateTime(selectedVisit.visitedAt)}</p>
            <Field label="Criticality"><select name="safetyCriticality" defaultValue="urgent">
              <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="critical">Critical</option>
            </select></Field>
          </div>
          <Field label="Related diagnosis (optional)"><select name="safetyDiagnosisId" defaultValue="">
            <option value="">Clinical finding not linked to a diagnosis</option>{chart.diagnoses.filter((diagnosis) => diagnosis.visitId === selectedVisit.id).map((diagnosis) => (
              <option key={diagnosis.id} value={diagnosis.id}>{diagnosis.diagnosisName}</option>
            ))}
          </select></Field>
          <Field label="Finding requiring attention"><input name="safetyTitle" maxLength={200} required placeholder="Concise alert title" /></Field>
          <Field label="Clinical details"><textarea name="safetyDescription" rows={3} maxLength={2000} required /></Field>
          <p className="workspace-help-copy">You will be recorded as the responsible clinician. Alerts cannot be deleted; acknowledge with the action taken, and resolve only with a documented reason.</p>
          <button className="primary-button" disabled={saving}><Bell /> {saving ? 'Flagging alert…' : 'Flag safety alert'}</button>
        </form> : <p className="chart-empty">Create or select a clinical visit before flagging a safety alert.</p>}
        {chart.clinicalSafetyAlerts.length > 0 && <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
          recordClinicalSafetyDecision({
            patientId,
            branchId,
            visitId: String(form.get('decisionVisit') ?? ''),
            alertId: String(form.get('decisionAlert') ?? ''),
            decision: String(form.get('decisionType') ?? 'rejected') as 'accepted_alternative' | 'modified' | 'rejected' | 'overridden',
            overrideReason: String(form.get('overrideReason') ?? ''),
            finalRecommendation: String(form.get('finalRecommendation') ?? ''),
            alternatives: [],
          }), 'Clinical safety decision recorded.')}>
          <h3>Record doctor's final decision</h3>
          <Field label="Related alert"><select name="decisionAlert" required><option value="">Select alert</option>{chart.clinicalSafetyAlerts.map((alert) => <option key={alert.id} value={alert.id}>{alert.title}</option>)}</select></Field>
          <Field label="Related visit"><select name="decisionVisit" defaultValue={selectedVisitId}><option value="">No visit linked</option>{chart.visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.visitNumber}</option>)}</select></Field>
          <Field label="Decision"><select name="decisionType"><option value="accepted_alternative">Accepted suggested alternative</option><option value="modified">Modified treatment or prescription</option><option value="rejected">Rejected recommendation</option><option value="overridden">Overrode alert</option></select></Field>
          <Field label="Override or clinical reason"><textarea name="overrideReason" rows={2} maxLength={2000} /></Field>
          <Field label="Final recommendation"><textarea name="finalRecommendation" rows={2} maxLength={3000} /></Field>
          <button className="secondary-button" disabled={saving}>Record decision</button>
        </form>}
      </article>

      <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Patient safety alerts</h2><p>{chart.clinicalSafetyAlerts.length} alert{chart.clinicalSafetyAlerts.length === 1 ? '' : 's'} · actions are permanently recorded.</p></div></div>
        {chart.clinicalSafetyAlerts.length ? <div className="safety-alert-list">{chart.clinicalSafetyAlerts.map((alert) => {
          const escalationDue = alert.escalationAfterMinutes === null
            || Date.now() >= new Date(alert.createdAt).getTime() + alert.escalationAfterMinutes * 60_000
          const mayAcknowledge = chart.canAcknowledgeClinicalSafetyAlerts && (alert.responsibleUserId === null
            || alert.responsibleUserId === chart.currentUserId
            || chart.canEscalateClinicalSafetyAlerts)
          return <article className={`safety-alert-card safety-alert-${alert.criticality}`} key={alert.id}>
            <div className="safety-alert-heading">
              <span className="safety-alert-badge">{alert.criticality}</span>
              <div><strong>{alert.title}</strong><small>{alert.status.replaceAll('_', ' ')} · flagged {dateTime(alert.createdAt)}</small></div>
            </div>
            <p>{alert.description}</p>
            {alert.responsibleUserId && <small>Responsible clinician: {alert.responsibleUserId === chart.currentUserId ? 'you' : alert.responsibleUserId.slice(0, 8)}</small>}
            {alert.acknowledgedAt && <p><strong>Acknowledged {dateTime(alert.acknowledgedAt)}</strong>{alert.acknowledgmentAction && <span>{alert.acknowledgmentAction}</span>}</p>}
            {alert.escalatedAt && <p><strong>Escalated to {alert.escalatedToRole?.replaceAll('_', ' ')} · {dateTime(alert.escalatedAt)}</strong></p>}
            {alert.resolvedAt && <p><strong>Resolved {dateTime(alert.resolvedAt)}</strong>{alert.resolutionReason && <span>{alert.resolutionReason}</span>}</p>}
            {alert.status !== 'resolved' && <>
              {mayAcknowledge && <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
                acknowledgeClinicalSafetyAlert(alert.id, String(form.get('acknowledgmentAction') ?? '')), 'Safety alert acknowledged.')}>
                <Field label="Action taken"><textarea name="acknowledgmentAction" rows={2} maxLength={2000} required /></Field>
                <button className="secondary-button" disabled={saving}>Acknowledge alert</button>
              </form>}
              {chart.canEscalateClinicalSafetyAlerts && alert.status !== 'acknowledged' && <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
                escalateClinicalSafetyAlert(
                  alert.id,
                  String(form.get('escalationRole') ?? 'branch_supervisor'),
                  String(form.get('escalationReason') ?? '')
                ), 'Safety alert escalated.')}>
                <p className="workspace-help-copy">{alert.escalationAfterMinutes
                  ? `Configured escalation interval: ${alert.escalationAfterMinutes} minutes${escalationDue ? ' (elapsed).' : ' (not elapsed yet).'}`
                  : 'No timed escalation is configured. A supervisor may escalate manually.'}</p>
                <div className="clinical-grid">
                  <Field label="Escalation target"><select name="escalationRole" defaultValue={alert.escalationTargetRole}>
                    <option value="branch_supervisor">Branch supervisor</option><option value="central_clinical_supervisor">Central clinical supervisor</option>
                  </select></Field>
                  <Field label="Reason"><input name="escalationReason" maxLength={1000} required /></Field>
                </div>
                <button className="secondary-button" disabled={saving}>Escalate alert</button>
              </form>}
              {alert.status === 'acknowledged' && <form className="clinical-form clinical-subform" onSubmit={(event) => handleSubmit(event, async (form) =>
                resolveClinicalSafetyAlert(alert.id, String(form.get('resolutionReason') ?? '')), 'Safety alert resolved.')}>
                <Field label="Resolution reason"><textarea name="resolutionReason" rows={2} maxLength={2000} required /></Field>
                <button className="secondary-button" disabled={saving}>Resolve alert</button>
              </form>}
            </>}
            <details className="clinical-details">
              <summary>Alert history ({alert.events.length})</summary>
              <div className="chart-timeline">{alert.events.map((event) => (
                <p key={event.id}><strong>{event.eventType.replaceAll('_', ' ')}</strong><small>{dateTime(event.createdAt)} · user {event.actorId.slice(0, 8)}</small>
                  {typeof event.details.reason === 'string' && <span>{event.details.reason}</span>}
                  {typeof event.details.action_taken === 'string' && <span>{event.details.action_taken}</span>}
                </p>
              ))}</div>
            </details>
          </article>
        })}</div> : <p className="chart-empty">No safety alerts have been flagged for this patient.</p>}
      </article>

      {chart.canManageClinicalSafetyAlerts && <article className="panel chart-panel">
        <div className="panel-header"><div><h2>Clinical escalation settings</h2><p>Changes apply prospectively and are audited. Clinical leadership retains responsibility for configured intervals.</p></div></div>
        <div className="safety-rule-list">{(['routine', 'urgent', 'critical'] as const).map((criticality) => {
          const rule = chart.clinicalSafetyAlertRules.find((item) => item.criticality === criticality)
          return <form className="clinical-form clinical-subform" key={criticality} onSubmit={(event) => handleSubmit(event, async (form) => {
            const interval = String(form.get('escalationAfterMinutes') ?? '').trim()
            return configureClinicalSafetyAlertRule({
              criticality,
              escalationAfterMinutes: interval ? Number(interval) : null,
              escalationRole: String(form.get('ruleEscalationRole') ?? 'branch_supervisor'),
              changeReason: String(form.get('ruleChangeReason') ?? ''),
            })
          }, `${criticality} alert escalation settings saved.`)}>
            <h3>{criticality.replace(/^./, (letter) => letter.toUpperCase())} alerts</h3>
            <div className="clinical-grid">
              <Field label="Escalate after minutes (blank for manual)"><input name="escalationAfterMinutes" type="number" min="1" max="10080" defaultValue={rule?.escalationAfterMinutes ?? ''} /></Field>
              <Field label="Escalation role"><select name="ruleEscalationRole" defaultValue={rule?.escalationRole ?? 'branch_supervisor'}>
                <option value="branch_supervisor">Branch supervisor</option><option value="central_clinical_supervisor">Central clinical supervisor</option>
              </select></Field>
            </div>
            <Field label="Reason for this configuration"><input name="ruleChangeReason" maxLength={1000} required /></Field>
            {rule && <small>Current rule: {rule.escalationAfterMinutes === null ? 'manual escalation only' : `${rule.escalationAfterMinutes} minutes`} · {rule.changeReason}</small>}
            <button className="secondary-button" disabled={saving}>Save {criticality} rule</button>
          </form>
        })}</div>
      </article>}
    </div>}
  </section>

  async function changeTreatmentItemStatus(
    itemId: string,
    status: 'awaiting_authorization' | 'approved' | 'scheduled' | 'in_progress' | 'completed'
  ) {
    setUpdatingTreatmentId(itemId)
    setFormError('')
    setNotice('')
    try {
      const result = await updateTreatmentPlanItemStatus(itemId, status)
      if (!result.ok) {
        setFormError(result.error)
        return
      }
      if (!await reload()) return
      setNotice(`Treatment item moved to ${status.replaceAll('_', ' ')}.`)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Treatment status could not be updated.')
    } finally {
      setUpdatingTreatmentId('')
    }
  }
}

function nextTreatmentStatuses(status: string): Array<'awaiting_authorization' | 'approved' | 'scheduled' | 'in_progress' | 'completed'> {
  if (status === 'proposed') return ['awaiting_authorization']
  if (status === 'awaiting_authorization') return ['approved']
  if (status === 'approved') return ['scheduled']
  if (status === 'scheduled') return ['in_progress']
  if (status === 'in_progress') return ['completed']
  return []
}

function treatmentActionLabel(status: string): string {
  switch (status) {
    case 'awaiting_authorization': return 'Request patient authorization'
    case 'approved': return 'Approve treatment'
    case 'scheduled': return 'Mark scheduled'
    case 'in_progress': return 'Start treatment'
    case 'completed': return 'Mark completed'
    default: return status
  }
}

function ToothButton({
  tooth,
  findings,
  selected,
  onSelect,
}: {
  tooth: string
  findings: ClinicalPatientChart['odontogram']
  selected: boolean
  onSelect: (tooth: string) => void
}) {
  const latest = findings.find((finding) => finding.toothNumber === tooth)
  const stageClass = latest ? `tooth-${latest.stage}` : ''
  return <button
    type="button"
    className={`odontogram-tooth ${stageClass} ${selected ? 'odontogram-tooth-selected' : ''}`}
    aria-pressed={selected}
    aria-label={`Tooth ${tooth}${latest ? `, latest finding ${latest.finding.replaceAll('_', ' ')}` : ''}`}
    title={latest ? `${latest.finding.replaceAll('_', ' ')} · ${latest.stage.replaceAll('_', ' ')}` : `Tooth ${tooth}`}
    onClick={() => onSelect(tooth)}
  >
    <span>{tooth}</span>
  </button>
}

function ClinicalRecordReview({
  records,
  canReview,
  canReviewEscalated,
  selectedId,
  onSelect,
  saving,
  onSubmitDraft,
  onSubmit,
  onResubmit,
}: {
  records: ClinicalPatientChart['clinicalRecords']
  canReview: boolean
  canReviewEscalated: boolean
  selectedId: string
  onSelect: (id: string) => void
  saving: boolean
  onSubmitDraft: (recordId: string) => Promise<void>
  onSubmit: (recordId: string, decision: 'approved' | 'returned' | 'escalated', comment: string) => Promise<void>
  onResubmit: (
    recordId: string,
    correctionReason: string,
    correctedRecord: { title: string; diagnosis: string }
  ) => Promise<boolean>
}) {
  const [reviewComment, setReviewComment] = useState('')
  const selected = records.find((record) => record.id === selectedId)
  const allowedRecords = records.filter((record) => record.canSubmit || canReview || canReviewEscalated)
  const draftRecords = allowedRecords.filter((record) => record.status === 'draft' && record.canSubmit)
  const reviewQueue = allowedRecords.filter((record) =>
    (record.status === 'submitted' && canReview)
    || (record.status === 'escalated' && canReviewEscalated)
  )
  const returnedRecords = allowedRecords.filter((record) => record.status === 'returned' && record.canSubmit)

  return <article className="panel chart-panel">
    <div className="panel-header"><div><h2>Clinical review &amp; correction</h2><p>Record submissions, decisions, and returned corrections are kept traceable.</p></div></div>
    {reviewQueue.length > 0 && <>
      <label className="clinical-field"><span>Records awaiting review</span>
        <select value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Select a record</option>
          {reviewQueue.map((record) => <option key={record.id} value={record.id}>{record.status === 'escalated' ? 'Escalated · ' : ''}{record.title} · {dateTime(record.createdAt)}</option>)}
        </select>
      </label>
      {selected && ['submitted', 'escalated'].includes(selected.status) && <div className="clinical-form clinical-subform">
        {selected.reviewComment && <p className="chart-inline-note">Previous reviewer note: {selected.reviewComment}</p>}
        <Field label="Reviewer comment (required for return or escalation)"><textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} rows={2} maxLength={1500} /></Field>
        <div className="clinical-review-actions">
          <button className="secondary-button" disabled={saving} onClick={() => void onSubmit(selected.id, 'approved', reviewComment)}>Approve</button>
          <button className="secondary-button" disabled={saving || !reviewComment.trim()} onClick={() => void onSubmit(selected.id, 'returned', reviewComment)}>Return for correction</button>
          {selected.status === 'submitted' && <button className="secondary-button" disabled={saving || !reviewComment.trim()} onClick={() => void onSubmit(selected.id, 'escalated', reviewComment)}>Escalate</button>}
        </div>
      </div>}
    </>}
    {(canReview || canReviewEscalated) && reviewQueue.length === 0 && <p className="chart-empty">No submitted or escalated records are awaiting review for this patient.</p>}
    {!canReview && !canReviewEscalated && <p className="chart-empty">Clinical record review actions are available to clinic supervisors.</p>}
    {draftRecords.map((record) => <div className="chart-returned-record" key={record.id}>
      <strong>{record.title} · Draft</strong>
      <p>{record.diagnosis || 'No notes entered.'}</p>
      <button className="secondary-button" disabled={saving} onClick={() => void onSubmitDraft(record.id)}>Submit this record for review</button>
    </div>)}
    {returnedRecords.map((record) => <ReturnedClinicalRecord
      key={record.id}
      record={record}
      saving={saving}
      onResubmit={onResubmit}
      onSubmitted={() => onSelect('')}
    />)}
  </article>
}

function ReturnedClinicalRecord({
  record,
  saving,
  onResubmit,
  onSubmitted,
}: {
  record: ClinicalPatientChart['clinicalRecords'][number]
  saving: boolean
  onResubmit: (
    recordId: string,
    correctionReason: string,
    correctedRecord: { title: string; diagnosis: string }
  ) => Promise<boolean>
  onSubmitted: () => void
}) {
  const [title, setTitle] = useState(record.title)
  const [diagnosis, setDiagnosis] = useState(record.diagnosis ?? '')
  const [correctionReason, setCorrectionReason] = useState('')
  const [error, setError] = useState('')

  return <form className="chart-returned-record" onSubmit={async (event) => {
    event.preventDefault()
    setError('')
    if (!title.trim() || !diagnosis.trim() || !correctionReason.trim()) {
      setError('Update the title and notes and explain the correction before resubmitting.')
      return
    }
    if (await onResubmit(record.id, correctionReason, { title, diagnosis })) onSubmitted()
  }}>
    <strong>{record.title} needs correction</strong>
    <p>Reviewer: {record.reviewComment || 'No reviewer comment was added.'}</p>
    <Field label="Corrected record title"><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></Field>
    <Field label="Corrected clinical notes"><textarea value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} rows={3} maxLength={3000} required /></Field>
    <Field label="Correction reason for resubmission"><input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={1000} required /></Field>
    {error && <span className="workspace-error" role="alert">{error}</span>}
    <button className="secondary-button" type="submit" disabled={saving || !correctionReason.trim()}>Resubmit corrected record for review</button>
  </form>
}
