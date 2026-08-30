import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '@/api/client'
import { CampusLogoFull } from '@/components/CampusLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Minimal password gate — only rendered when the server requires auth. */
export function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { ok, status } = await api.auth.login(password)
      if (ok || status === 403) {
        // 403 = auth disabled server-side (raced with a config change) — open
        onAuthed()
      } else {
        setError('Wrong password')
      }
    } catch {
      setError('Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form onSubmit={submit} className="login-card">
        <div className="login-card-head">
          <CampusLogoFull height={34} className="login-card-logo" />
          <p className="login-card-sub">Enter the access password to continue.</p>
        </div>
        <Input
          type="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          disabled={busy}
          autoComplete="current-password"
        />
        {error && <p className="login-card-error">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}
