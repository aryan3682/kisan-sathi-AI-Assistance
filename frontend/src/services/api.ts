import {
  DashboardData,
  WeatherData,
  FieldItem,
  Observation,
  ChatMessage,
  CropAssessmentResult,
  SchemeItem,
  SchemeEligibilityResponse,
  Language,
  AccountUser,
  AppConfig,
} from '../types';

const API_BASE = ((import.meta as any).env && (import.meta as any).env.VITE_API_BASE_URL) || '/api/v1';
const API_REQUEST_TIMEOUT_MS = 60_000;
const DASHBOARD_REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = API_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const defaultHeaders: Record<string, string> = {
    'Accept': 'application/json',
  };

  // Only set Content-Type to JSON if body is not FormData
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  const config: RequestInit = {
    ...options,
    signal: controller.signal,
    credentials: 'include',
    headers: {
      ...defaultHeaders,
      ...(options.headers || {}),
    },
  };

  try {
    const response = await fetch(url, config);
    if (!response.ok) {
      let errMessage = `HTTP Error ${response.status}: ${response.statusText}`;
      try {
        const errorJson = await response.json();
        if (errorJson.detail) {
          errMessage = typeof errorJson.detail === 'string' ? errorJson.detail : JSON.stringify(errorJson.detail);
        }
      } catch (_) {
        // use default error message
      }
      throw new ApiError(errMessage, response.status);
    }
    
    // For 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return await response.json();
  } catch (error: any) {
    if (controller.signal.aborted) {
      const timeoutError = new ApiError('The request timed out. Check your connection and try again.', 408);
      console.error(`API request timed out on ${endpoint}`);
      throw timeoutError;
    }
    if (!(error instanceof ApiError && error.status === 401)) {
      console.error(`API Error on ${endpoint}:`, error);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  // Health & Config
  getHealth: () => request<{ status: string; service: string; version: string }>('/health'),
  getConfig: () => request<AppConfig>('/config'),

  getCurrentUser: () => request<AccountUser>('/auth/me', {}, DASHBOARD_REQUEST_TIMEOUT_MS),

  register: (data: { name: string; email: string; password: string }) =>
    request<AccountUser>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<AccountUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  demoLogin: (otp: string) =>
    request<AccountUser>('/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ otp }),
    }),

  logout: () =>
    request<void>('/auth/logout', {
      method: 'POST',
    }),

  // Dashboard
  getDashboard: (location?: string, district?: string, state?: string) => {
    const params = new URLSearchParams();
    if (location) params.append('location', location);
    if (district) params.append('district', district);
    if (state) params.append('state', state);
    return request<DashboardData>(
      `/dashboard?${params.toString()}`,
      {},
      DASHBOARD_REQUEST_TIMEOUT_MS,
    );
  },

  // Chat
  sendChat: (data: {
    message: string;
    session_id?: string;
    language?: Language;
    crop_context?: string;
    growth_stage_context?: string;
    location_context?: string;
    field_id?: number;
  }) => request<{
    session_id: string;
    message: ChatMessage;
    suggested_follow_ups: string[];
    provider: string;
  }>('/chat', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  getChatHistory: (sessionId: string) =>
    request<ChatMessage[]>(`/chat/history?session_id=${encodeURIComponent(sessionId)}`),

  // Crop Health Assessment
  submitCropAssessment: (formData: FormData) =>
    request<CropAssessmentResult>('/crop-assessments', {
      method: 'POST',
      body: formData,
    }),

  // Weather
  getWeather: (location?: string, district?: string, state?: string, cropContext?: string, growthStageContext?: string) => {
    const params = new URLSearchParams();
    if (location) params.append('location', location);
    if (district) params.append('district', district);
    if (state) params.append('state', state);
    if (cropContext) params.append('crop_context', cropContext);
    if (growthStageContext) params.append('growth_stage_context', growthStageContext);
    return request<WeatherData>(`/weather?${params.toString()}`);
  },

  // Schemes
  getSchemes: (category?: string, search?: string) => {
    const params = new URLSearchParams();
    if (category && category !== 'All') params.append('category', category);
    if (search) params.append('search', search);
    return request<SchemeItem[]>(`/schemes?${params.toString()}`);
  },

  getSchemeById: (id: string) => request<SchemeItem>(`/schemes/${encodeURIComponent(id)}`),

  evaluateSchemeEligibility: (payload: {
    scheme_id?: string;
    land_holding_acres: number;
    category: string;
    state: string;
    district?: string;
    has_aadhaar_linked_bank: boolean | null;
    has_7_12_extract: boolean | null;
    has_irrigation: boolean | null;
    has_active_pm_kisan: boolean | null;
    pm_kisan_exclusion_applies: boolean | null;
    cultivates_notified_crop: boolean | null;
    received_same_survey_micro_irrigation_subsidy: boolean | null;
  }) =>
    request<SchemeEligibilityResponse>('/schemes/eligibility', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Fields
  getFields: () => request<FieldItem[]>('/fields'),
  
  createField: (field: {
    name: string;
    location: string;
    crop: string;
    planting_date?: string;
    area: number;
    area_unit: string;
    growth_stage: string;
    notes?: string;
  }) =>
    request<FieldItem>('/fields', {
      method: 'POST',
      body: JSON.stringify(field),
    }),

  getFieldById: (fieldId: number) => request<FieldItem>(`/fields/${fieldId}`),

  updateField: (fieldId: number, field: Partial<FieldItem>) =>
    request<FieldItem>(`/fields/${fieldId}`, {
      method: 'PATCH',
      body: JSON.stringify(field),
    }),

  deleteField: (fieldId: number) =>
    request<void>(`/fields/${fieldId}`, {
      method: 'DELETE',
    }),

  addObservation: (fieldId: number, observation: {
    date: string;
    growth_stage?: string;
    notes: string;
    photo_url?: string;
  }) =>
    request<Observation>(`/fields/${fieldId}/observations`, {
      method: 'POST',
      body: JSON.stringify(observation),
    }),

  getObservations: (fieldId: number) =>
    request<Observation[]>(`/fields/${fieldId}/observations`),
};
