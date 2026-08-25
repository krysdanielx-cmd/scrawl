import { useState } from 'react';
import { api } from '../api.js';

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      onAuthenticated(await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(form) }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <section className="auth-intro" aria-label="About Scrawl">
        <div className="mark" aria-hidden="true">S</div>
        <div>
          <p className="eyebrow">Private working notes</p>
          <h1>Scrawl<span className="dot">.</span></h1>
          <p className="auth-copy">A quiet desk for loose thoughts, meeting notes, and the things worth finding again.</p>
        </div>
        <p className="auth-foot">No feeds. No collaborators. Just your work.</p>
      </section>

      <section className="auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Set up your desk'}</p>
          <h2 className="display display-lg">{mode === 'login' ? 'Open Scrawl' : 'Create the owner account'}</h2>

          <div className="form-row">
            <label htmlFor="email">Email</label>
            <input
              id="email" name="email" type="email" className="field"
              autoComplete="email" required maxLength={254}
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </div>

          <div className="form-row">
            <label htmlFor="password">Password</label>
            <input
              id="password" name="password" type="password" className="field"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required minLength={10} maxLength={128}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
            {mode === 'signup' && <small>Use at least 10 characters.</small>}
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'One moment' : mode === 'login' ? 'Open desk' : 'Create Scrawl'}
          </button>

          <button className="link-btn" type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>
            {mode === 'login' ? 'First time here? Create the owner account' : 'Already set up? Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
