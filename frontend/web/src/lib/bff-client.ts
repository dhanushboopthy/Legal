import axios from 'axios'

import type { UserOut } from '@/types/api'

// Talks only to the tiny Node BFF, never the FastAPI backend directly. The
// httpOnly refresh-token cookie rides along automatically via
// withCredentials; the SPA's JS never sees it.
export const bffClient = axios.create({
  baseURL: '/bff',
  withCredentials: true,
})

export interface LoginResponse {
  access_token: string
  user: UserOut
}

export async function bffLogin(email: string, password: string): Promise<LoginResponse> {
  const { data } = await bffClient.post<LoginResponse>('/login', { email, password })
  return data
}

export async function bffLoginWithGoogle(idToken: string): Promise<LoginResponse> {
  const { data } = await bffClient.post<LoginResponse>('/login/google', { id_token: idToken })
  return data
}

export async function bffVerifyEmail(email: string, code: string): Promise<LoginResponse> {
  const { data } = await bffClient.post<LoginResponse>('/verify-email', { email, code })
  return data
}

export async function bffRefresh(): Promise<LoginResponse> {
  const { data } = await bffClient.post<LoginResponse>('/refresh')
  return data
}

export async function bffLogout(): Promise<void> {
  await bffClient.post('/logout')
}
