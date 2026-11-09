// Shared types for the administration centre.

export interface PermissionDef { key: string; label: string; category: string }
export interface RoleDef { name: string; label: string }

export interface UserRow {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: string;
  status: string;
  last_login_at: string | null;
  created_at: string;
  must_change_password: number | boolean;
  locked_until: string | null;
  failed_attempts: number;
  phone: string | null;
  department: string | null;
  job_title: string | null;
  employee_ref: string | null;
  staff_id: string | null;
  permissions: string[];
  revoked_permissions: string[];
}

export interface DepartmentRow {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  dashboard_route: string | null;
  staff_count: number;
  user_count: number;
  created_at: string;
}

export interface ApiConfig {
  id: string;
  kind: string;
  provider: string;
  provider_label: string;
  name: string;
  base_url: string;
  model: string;
  api_version: string;
  org_id: string;
  extra_headers: string;
  max_tokens: number | null;
  temperature: number | null;
  timeout_ms: number;
  enabled: boolean;
  is_primary: boolean;
  is_backup: boolean;
  has_key: boolean;
  key_hint: string | null;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderDef { key: string; label: string; base_url: string; model: string }

export interface OverviewData {
  users: { total: number; active: number; suspended: number; deactivated: number };
  departments: number;
  failed_logins_24h: number;
  locked_accounts: { id: string; email: string; full_name: string; locked_until: string }[];
  suspicious_emails: { email: string; c: number }[];
  recent_logins: {
    id: string; email: string; success: number; reason: string | null;
    ip: string | null; created_at: string; full_name: string | null;
  }[];
  recent_accounts: {
    id: string; full_name: string; email: string; role: string; status: string;
    created_at: string; department: string | null;
  }[];
  recent_changes: { action: string; summary: string | null; user_email: string | null; created_at: string }[];
  users_by_role: { role: string; c: number }[];
  users_by_department: { department: string; c: number }[];
  generated_at: string;
}

export interface SecurityPolicy {
  max_failed_attempts: number;
  lockout_minutes: number;
  session_hours: number;
  min_password_length: number;
  require_strong_password: boolean;
  mfa_available: boolean;
}

export interface VoiceSettings {
  input_enabled: boolean;
  output_enabled: boolean;
  recognition_language: string;
  voice_name: string;
  speech_rate: number;
  speech_pitch: number;
  wake_word_enabled: boolean;
  wake_word: string;
  text_to_speech_provider: string;
  speech_to_text_provider: string;
}

export interface MemorySettings {
  enabled: boolean;
  user_memory: boolean;
  department_memory: boolean;
  retention_days: number;
  max_entries_per_user: number;
}

export interface MemoryRow {
  id: string;
  user_id: string | null;
  scope: string;
  memory_key: string;
  content: string;
  created_at: string;
  updated_at: string;
  full_name: string | null;
  email: string | null;
}

export interface LoginEvent {
  id: string;
  user_id: string | null;
  email: string;
  success: number;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  full_name: string | null;
}

export interface AuditRow {
  id: string;
  user_email: string | null;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  ip: string | null;
  created_at: string;
}
