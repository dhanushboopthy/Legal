import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as backendClient from '../backend-client.js'
import { app } from '../server.js'

vi.mock('../backend-client.js', async () => {
  const actual = await vi.importActual<typeof backendClient>('../backend-client.js')
  return {
    ...actual,
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    refresh: vi.fn(),
    verifyEmail: vi.fn(),
    getMe: vi.fn(),
  }
})

describe('POST /login', () => {
  beforeEach(() => {
    vi.mocked(backendClient.login).mockReset()
    vi.mocked(backendClient.getMe).mockReset()
  })

  it('sets an httpOnly refresh cookie and returns the access token + user', async () => {
    vi.mocked(backendClient.login).mockResolvedValue({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'bearer',
    })
    vi.mocked(backendClient.getMe).mockResolvedValue({
      id: 'u1',
      full_name: 'Jane Lawyer',
      email: 'jane@example.com',
      phone: null,
      bar_council_id: null,
      role_name: 'junior_lawyer',
      permissions: ['case:submit'],
      is_active: true,
      is_verified: true,
    })

    const res = await request(app).post('/login').send({ email: 'jane@example.com', password: 'x' })

    expect(res.status).toBe(200)
    expect(res.body.access_token).toBe('access-1')
    expect(res.body.user.email).toBe('jane@example.com')

    const setCookie = res.headers['set-cookie']?.[0] ?? ''
    expect(setCookie).toContain('refresh_token=refresh-1')
    expect(setCookie.toLowerCase()).toContain('httponly')
    // Refresh token itself never appears outside the cookie.
    expect(res.text).not.toContain('refresh-1')
  })

  it('rejects a request missing credentials', async () => {
    const res = await request(app).post('/login').send({ email: 'jane@example.com' })
    expect(res.status).toBe(400)
    expect(backendClient.login).not.toHaveBeenCalled()
  })

  it('propagates a 401 from the backend without leaking internals', async () => {
    vi.mocked(backendClient.login).mockRejectedValue(
      new backendClient.BackendError(401, 'Incorrect email or password'),
    )

    const res = await request(app)
      .post('/login')
      .send({ email: 'jane@example.com', password: 'wrong' })
    expect(res.status).toBe(401)
    expect(res.body.detail).toBe('Incorrect email or password')
  })
})

describe('POST /login/google', () => {
  beforeEach(() => {
    vi.mocked(backendClient.loginWithGoogle).mockReset()
    vi.mocked(backendClient.getMe).mockReset()
  })

  it('sets the refresh cookie and returns the access token + user', async () => {
    vi.mocked(backendClient.loginWithGoogle).mockResolvedValue({
      access_token: 'access-g',
      refresh_token: 'refresh-g',
      token_type: 'bearer',
    })
    vi.mocked(backendClient.getMe).mockResolvedValue({
      id: 'u2',
      full_name: 'Googler',
      email: 'googler@example.com',
      phone: null,
      bar_council_id: null,
      role_name: 'junior_lawyer',
      permissions: ['case:submit'],
      is_active: true,
      is_verified: true,
    })

    const res = await request(app).post('/login/google').send({ id_token: 'raw-google-jwt' })

    expect(res.status).toBe(200)
    expect(res.body.access_token).toBe('access-g')
    expect(backendClient.loginWithGoogle).toHaveBeenCalledWith('raw-google-jwt')
    const setCookie = res.headers['set-cookie']?.[0] ?? ''
    expect(setCookie).toContain('refresh_token=refresh-g')
  })

  it('rejects a request missing id_token', async () => {
    const res = await request(app).post('/login/google').send({})
    expect(res.status).toBe(400)
    expect(backendClient.loginWithGoogle).not.toHaveBeenCalled()
  })

  it('propagates a 401 from the backend', async () => {
    vi.mocked(backendClient.loginWithGoogle).mockRejectedValue(
      new backendClient.BackendError(401, 'Invalid Google credential'),
    )
    const res = await request(app).post('/login/google').send({ id_token: 'bad' })
    expect(res.status).toBe(401)
    expect(res.body.detail).toBe('Invalid Google credential')
  })
})

describe('POST /verify-email', () => {
  beforeEach(() => {
    vi.mocked(backendClient.verifyEmail).mockReset()
    vi.mocked(backendClient.getMe).mockReset()
  })

  it('signs the freshly-verified account in, pending approval or not', async () => {
    vi.mocked(backendClient.verifyEmail).mockResolvedValue({
      access_token: 'access-v',
      refresh_token: 'refresh-v',
      token_type: 'bearer',
    })
    vi.mocked(backendClient.getMe).mockResolvedValue({
      id: 'u3',
      full_name: 'New Lawyer',
      email: 'new@example.com',
      phone: null,
      bar_council_id: null,
      role_name: 'junior_lawyer',
      permissions: ['case:submit'],
      is_active: false,
      is_verified: true,
    })

    const res = await request(app)
      .post('/verify-email')
      .send({ email: 'new@example.com', code: '123456' })

    expect(res.status).toBe(200)
    expect(res.body.access_token).toBe('access-v')
    expect(res.body.user.is_active).toBe(false)
    const setCookie = res.headers['set-cookie']?.[0] ?? ''
    expect(setCookie).toContain('refresh_token=refresh-v')
    expect(setCookie.toLowerCase()).toContain('httponly')
  })

  it('rejects a request missing the code', async () => {
    const res = await request(app).post('/verify-email').send({ email: 'new@example.com' })
    expect(res.status).toBe(400)
    expect(backendClient.verifyEmail).not.toHaveBeenCalled()
  })

  it('propagates a wrong-code error from the backend', async () => {
    vi.mocked(backendClient.verifyEmail).mockRejectedValue(
      new backendClient.BackendError(422, 'Invalid or expired code'),
    )
    const res = await request(app)
      .post('/verify-email')
      .send({ email: 'new@example.com', code: '000000' })
    expect(res.status).toBe(422)
    expect(res.body.detail).toBe('Invalid or expired code')
  })
})

describe('POST /refresh', () => {
  it('returns 401 when there is no refresh cookie', async () => {
    const res = await request(app).post('/refresh')
    expect(res.status).toBe(401)
  })
})

describe('POST /logout', () => {
  it('clears the refresh cookie', async () => {
    const res = await request(app).post('/logout')
    expect(res.status).toBe(204)
    const setCookie = res.headers['set-cookie']?.[0] ?? ''
    expect(setCookie).toContain('refresh_token=;')
  })
})
