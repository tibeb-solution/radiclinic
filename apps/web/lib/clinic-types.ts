export type ClinicPlan = 'Starter' | 'Growth' | 'Enterprise'
export type ClinicStatus = 'active' | 'suspended'

export interface ManagedClinic {
  id: string
  name: string
  email: string
  branchName: string
  plan: ClinicPlan
  status: ClinicStatus
  administratorActive: boolean
  createdAt: string
}
