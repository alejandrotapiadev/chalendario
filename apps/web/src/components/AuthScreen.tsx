import { useState, type FormEvent } from 'react';
import type { UserDto } from '@calendar/shared';
import { PASSWORD_MIN } from '@calendar/shared';
import { ApiError, api } from '../api.ts';

interface Props {
  onAuthenticated: (user: UserDto) => void;
}

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = mode === 'register';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = registering
        ? await api.register({ name, email, password })
        : await api.login({ email, password });
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo conectar con el servidor');
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Personal Calendar</h1>
        <p className="muted">{registering ? 'Crea tu cuenta' : 'Inicia sesión'}</p>

        {registering && (
          <label className="field">
            <span>Nombre</span>
            <input
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input
            required
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            minLength={registering ? PASSWORD_MIN : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {registering && <span className="muted">Mínimo {PASSWORD_MIN} caracteres</span>}
        </label>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {registering ? 'Crear cuenta' : 'Entrar'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(registering ? 'login' : 'register');
            setError(null);
          }}
        >
          {registering ? 'Ya tengo cuenta' : 'Crear una cuenta'}
        </button>
      </form>
    </main>
  );
}
