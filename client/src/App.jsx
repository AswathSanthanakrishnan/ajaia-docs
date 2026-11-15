import React, { useState, useEffect } from 'react';
import { getToken, clearToken, getMe } from './api';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EditorPage from './pages/EditorPage';

function parseUrl() {
  const path = window.location.pathname;
  const docMatch = path.match(/^\/docs?\/([^/]+)/);
  if (docMatch) {
    return { route: 'editor', docId: docMatch[1] };
  }
  return { route: 'dashboard', docId: null };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [initLoading, setInitLoading] = useState(true);
  const [currentView, setCurrentView] = useState(() => parseUrl());

  // Check auth session on startup
  useEffect(() => {
    async function initAuth() {
      const token = getToken();
      if (!token) {
        setInitLoading(false);
        return;
      }

      try {
        const userData = await getMe();
        setUser(userData);
      } catch (err) {
        // Invalid or expired token
        clearToken();
        setUser(null);
      } finally {
        setInitLoading(false);
      }
    }

    initAuth();
  }, []);

  // Sync with browser history (back / forward buttons)
  useEffect(() => {
    function handlePopState() {
      setCurrentView(parseUrl());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function navigateTo(route, docId = null) {
    let path = '/';
    if (route === 'editor' && docId) {
      path = `/docs/${docId}`;
    } else if (route === 'login') {
      path = '/login';
    }

    window.history.pushState(null, '', path);
    setCurrentView({ route, docId });
  }

  function handleLoginSuccess(userData) {
    setUser(userData);
    navigateTo('dashboard');
  }

  function handleLogout() {
    clearToken();
    setUser(null);
    navigateTo('login');
  }

  function handleOpenDoc(docId) {
    navigateTo('editor', docId);
  }

  function handleBackToDashboard() {
    navigateTo('dashboard');
  }

  if (initLoading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading Ajaia Docs...
      </div>
    );
  }

  // If user is not authenticated, show login page
  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // Editor page
  if (currentView.route === 'editor' && currentView.docId) {
    return (
      <EditorPage
        docId={currentView.docId}
        onBack={handleBackToDashboard}
      />
    );
  }

  // Dashboard page (default authenticated view)
  return (
    <DashboardPage
      user={user}
      onLogout={handleLogout}
      onOpenDoc={handleOpenDoc}
    />
  );
}
