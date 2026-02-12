// Database types for Auto366

export interface Database {
  public: {
    Tables: {
      rulesets: {
        Row: Ruleset
        Insert: RulesetInsert
        Update: RulesetUpdate
      }
      admin_profiles: {
        Row: AdminProfile
        Insert: AdminProfileInsert
        Update: AdminProfileUpdate
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_download_count: {
        Args: { ruleset_id: string }
        Returns: void
      }
      approve_ruleset: {
        Args: { ruleset_id: string }
        Returns: void
      }
      reject_ruleset: {
        Args: { ruleset_id: string }
        Returns: void
      }
      update_admin_last_login: {
        Args: {}
        Returns: void
      }
    }
    Enums: {
      ruleset_status: 'pending' | 'approved' | 'rejected'
    }
  }
}

// Table row types
export interface Ruleset {
  id: string
  name: string
  description: string | null
  author: string
  status: 'pending' | 'approved' | 'rejected'
  json_file_size: number | null
  zip_file_size: number | null
  has_injection_package: boolean
  download_count: number
  created_at: string
  updated_at: string
  approved_at: string | null
  approved_by: string | null
}

export interface AdminProfile {
  id: string
  email: string
  created_at: string
  last_login: string | null
}

// Insert types (for creating new records)
export interface RulesetInsert {
  id?: string
  name: string
  description?: string | null
  author: string
  status?: 'pending' | 'approved' | 'rejected'
  json_file_size?: number | null
  zip_file_size?: number | null
  has_injection_package?: boolean
  download_count?: number
  created_at?: string
  updated_at?: string
  approved_at?: string | null
  approved_by?: string | null
}

export interface AdminProfileInsert {
  id: string
  email: string
  created_at?: string
  last_login?: string | null
}

// Update types (for updating existing records)
export interface RulesetUpdate {
  id?: string
  name?: string
  description?: string | null
  author?: string
  status?: 'pending' | 'approved' | 'rejected'
  json_file_size?: number | null
  zip_file_size?: number | null
  has_injection_package?: boolean
  download_count?: number
  created_at?: string
  updated_at?: string
  approved_at?: string | null
  approved_by?: string | null
}

export interface AdminProfileUpdate {
  id?: string
  email?: string
  created_at?: string
  last_login?: string | null
}

// Frontend-specific types
export interface RulesetWithFiles extends Ruleset {
  jsonFileUrl?: string
  zipFileUrl?: string
}

export interface RulesetUploadData {
  name: string
  description: string
  author: string
  jsonFile: File
  zipFile?: File
}

export interface AdminUser {
  id: string
  email: string
  profile?: AdminProfile
}

// API response types
export interface ApiResponse<T = any> {
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

// Filter and sort types
export interface RulesetFilters {
  search?: string
  author?: string
  status?: 'pending' | 'approved' | 'rejected'
  hasInjectionPackage?: boolean
}

export interface RulesetSort {
  field: 'created_at' | 'download_count' | 'name' | 'author'
  direction: 'asc' | 'desc'
}

export interface PaginationParams {
  page: number
  pageSize: number
}