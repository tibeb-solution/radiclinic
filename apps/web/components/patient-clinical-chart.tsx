'use client'

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  addOdontogramFinding,
  addPatientHistoryEntry,
  addVisitDiagnosis,
  createClinicPrescription,
  createClinicTreatmentPlan,
  createClinicalEncounter,
  getClinicalAttachmentUrl,
  getClinicalPatientChart,
  recordPatientConsent,
  recordPerformedProcedure,
  reviewClinicalRecord,
  submitClinicalRecord,
  updateTreatmentPlanItemStatus,
  uploadClinicalAttachment,
  updateClinicPatientProfile,
  type ClinicalEncounterInput,
  type ClinicalPatientChart,
} from '@/app/auth-actions'
import { ArrowLeft, Check, ClipboardPlus, FileHeart, HeartPulse, Plus, Stethoscope, UserRound } from 'lucide-react'

type ChartSection = 'profile' | 'history' | 'visits' | 'dental' | 'treatments' | 'documents'

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
}: {
  patientId: string
  branchId: string
  onClose: () => void
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

  const selectedVisit = useMemo(
    () => chart?.visits.find((visit) => visit.id === selectedVisitId) ?? null,
    [chart, selectedVisitId]
  )

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    operation: (form: FormData) => Promise<{ ok: boolean; error?: string; value?: string }>,
    successMessage: string,
    resetOnSuccess = true
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
      setNotice(successMessage)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The change could not be saved.')
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
  const visibleDiagnoses = selectedVisit
    ? chart.diagnoses.filter((diagnosis) => diagnosis.visitId === selectedVisit.id)
    : []

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
        <div className="panel-header"><div><h2>History timeline</h2><p>{chart.historyEntries.length} preserved entr{chart.historyEntries.length === 1 ? 'y' : 'ies'}</p></div></div>
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
              name: String(form.get('diagnosisName') ?? ''),
              code: String(form.get('diagnosisCode') ?? ''),
              description: String(form.get('diagnosisDescription') ?? ''),
              location: String(form.get('diagnosisLocation') ?? ''),
              toothNumber: String(form.get('diagnosisTooth') ?? ''),
              findings: String(form.get('diagnosisFindings') ?? ''),
            }), 'Diagnosis added to the selected visit.')}>
            <h3>Add diagnosis</h3>
            <Field label="Diagnosis"><input name="diagnosisName" maxLength={200} required /></Field>
            <div className="clinical-grid">
              <Field label="Code (optional)"><input name="diagnosisCode" maxLength={50} /></Field>
              <Field label="Tooth / location"><input name="diagnosisTooth" maxLength={30} /></Field>
            </div>
            <Field label="Description"><textarea name="diagnosisDescription" rows={2} maxLength={1500} /></Field>
            <Field label="Supporting findings"><textarea name="diagnosisFindings" rows={2} maxLength={1500} /></Field>
            <button className="secondary-button" disabled={saving}><Plus /> Add diagnosis</button>
          </form>
          {visibleDiagnoses.length > 0 && <div className="chart-diagnosis-list">{visibleDiagnoses.map((diagnosis) => (
            <article key={diagnosis.id}><strong>{diagnosis.diagnosisName}</strong>{diagnosis.diagnosisCode && <span>{diagnosis.diagnosisCode}</span>}<p>{diagnosis.description || diagnosis.supportingFindings || 'No additional notes'}</p></article>
          ))}</div>}
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
