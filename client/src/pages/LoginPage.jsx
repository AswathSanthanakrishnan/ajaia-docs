import React, { useState } from 'react';
import { login, setToken } from '../api';

const DEMO_ACCOUNTS = [
  { name: 'Maya Chen', email: 'maya@demo.io' },
  { name: 'Jordan Lee', email: 'jordan@demo.io' },
  { name: 'Priya Nair', email: 'priya@demo.io' }
];

export default function LoginPage({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleLogin(e, loginEmail = email, loginPassword = password) {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    setError(null);
    setLoading(true);

    try {
      const data = await login(loginEmail, loginPassword);
      setToken(data.token);
      if (onLoginSuccess) {
        onLoginSuccess(data.user);
      }
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function handleDemoClick(account) {
    setEmail(account.email);
    setPassword('demo1234');
    handleLogin(null, account.email, 'demo1234');
  }

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <h1 className="login-title">Ajaia Docs</h1>
        <p className="login-subtitle">Sign in to your account</p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@demo.io"
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '4px' }}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="demo-accounts-section">
          <div className="demo-accounts-title">One-click demo accounts</div>
          <div className="demo-buttons-list">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="btn-demo"
                onClick={() => handleDemoClick(account)}
                disabled={loading}
              >
                <span>{account.name}</span>
                <span className="demo-email">{account.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
