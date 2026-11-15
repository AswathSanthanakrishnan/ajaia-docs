import React, { useState, useEffect } from 'react';
import { getDocShares, shareDoc, deleteDocShare } from '../api';

export default function ShareModal({ docId, onClose }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [shares, setShares] = useState([]);
  const [loadingShares, setLoadingShares] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function loadShares() {
    try {
      const data = await getDocShares(docId);
      setShares(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load shares');
    } finally {
      setLoadingShares(false);
    }
  }

  useEffect(() => {
    loadShares();
  }, [docId]);

  async function handleShareSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;

    setError(null);
    setSubmitting(true);

    try {
      await shareDoc(docId, email.trim(), role);
      setEmail('');
      await loadShares();
    } catch (err) {
      setError(err.message || 'Failed to share document');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveShare(userId) {
    setError(null);
    try {
      await deleteDocShare(docId, userId);
      setShares((prev) => prev.filter((s) => s.user_id !== userId));
    } catch (err) {
      setError(err.message || 'Failed to remove share');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Share document</div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          <form onSubmit={handleShareSubmit} className="share-form">
            <div className="share-input-row">
              <div style={{ flex: 2 }}>
                <label className="form-label" htmlFor="share-email">User email</label>
                <input
                  id="share-email"
                  type="email"
                  className="form-input"
                  placeholder="colleague@demo.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>

              <div style={{ flex: 1 }}>
                <label className="form-label" htmlFor="share-role">Access</label>
                <select
                  id="share-role"
                  className="form-select"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  disabled={submitting}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !email.trim()}
              >
                {submitting ? 'Sharing...' : 'Share'}
              </button>
            </div>
          </form>

          <div className="shares-list-section">
            <div className="shares-list-title">People with access</div>

            {loadingShares ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading shares...</p>
            ) : shares.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Not shared with anyone yet.</p>
            ) : (
              <div className="shares-list">
                {shares.map((share) => (
                  <div key={share.id || share.user_id} className="share-row">
                    <div className="share-user-info">
                      <span className="share-user-name">{share.name}</span>
                      <span className="share-user-email">{share.email}</span>
                    </div>

                    <div className="share-row-actions">
                      <span className={`badge ${share.role === 'editor' ? 'badge-editor' : 'badge-viewer'}`}>
                        {share.role === 'editor' ? 'Editor' : 'Viewer'}
                      </span>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleRemoveShare(share.user_id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
