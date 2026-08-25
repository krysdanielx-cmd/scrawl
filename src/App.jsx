import { lazy, Suspense, useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken } from './api.js';
import AuthPage from './pages/AuthPage.jsx';
import Workspace from './pages/Workspace.jsx';
const PublicNote = lazy(() => import('./pages/PublicNote.jsx'));

/** The only real route in the app: /p/:slug is the signed-out reader view. */
function publicSlug() {
  const match = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]{12,64})\/?$/);
  return match ? match[1] : null;
}

export default function App() {
  const slug = publicSlug();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(!slug && Boolean(getToken()));

  useEffect(() => {
    if (slug || !getToken()) return;
    api('/me')
      .then(setSession)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, [slug]);

  if (slug) return <Suspense fallback={<main className="boot">Loading note...</main>}><PublicNote slug={slug} /></Suspense>;

  function handleAuthenticated(payload) {
    setToken(payload.token);
    setSession({ user: payload.user, folders: payload.folders || [] });
  }

  function handleSignOut() {
    clearToken();
    setSession(null);
  }

  if (loading) return <main className="boot" aria-live="polite">Opening your desk...</main>;

  return session
    ? <Workspace session={session} onSignOut={handleSignOut} />
    : <AuthPage onAuthenticated={handleAuthenticated} />;
}
