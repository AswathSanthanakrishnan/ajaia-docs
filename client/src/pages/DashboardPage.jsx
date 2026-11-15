import React, { useState, useEffect, useRef } from 'react';
import { getDocs, createDoc, deleteDoc, uploadDoc } from '../api';

function formatAccessRole(access) {
  if (!access) return '';
  const lower = access.toLowerCase();
  if (lower === 'owner') return 'Owner';
  if (lower === 'editor') return 'Editor';
  if (lower === 'viewer') return 'Viewer';
  return access;
}

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

export default function DashboardPage({ user, onLogout, onOpenDoc }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const fileInputRef = useRef(null);

  async function loadDocuments() {
    setError(null);
    try {
      const data = await getDocs();
      setDocs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  async function handleNewDoc() {
    const title = window.prompt('Enter document title:', 'Untitled document');
    if (title === null) {
      return; // User cancelled prompt
    }
    const trimmedTitle = title.trim() || 'Untitled document';

    setActionLoading(true);
    setError(null);
    try {
      const newDoc = await createDoc(trimmedTitle);
      if (onOpenDoc && newDoc?.id) {
        onOpenDoc(newDoc.id);
      } else {
        await loadDocuments();
      }
    } catch (err) {
      setError(err.message || 'Failed to create document');
      setActionLoading(false);
    }
  }

  function handleUploadClick() {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedExtensions = ['.txt', '.md', '.docx'];
    const fileName = file.name.toLowerCase();
    const isAllowed = allowedExtensions.some((ext) => fileName.endsWith(ext));

    if (!isAllowed) {
      setError('Unsupported file type. Please upload a .txt, .md, or .docx file.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('File size exceeds 2 MB limit');
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const uploadedDoc = await uploadDoc(file);
      if (onOpenDoc && uploadedDoc?.id) {
        onOpenDoc(uploadedDoc.id);
      } else {
        await loadDocuments();
      }
    } catch (err) {
      setError(err.message || 'Failed to upload document');
      setActionLoading(false);
    }
  }

  async function handleDeleteDoc(e, doc) {
    e.stopPropagation();
    const confirmed = window.confirm(`Are you sure you want to delete "${doc.title}"?`);
    if (!confirmed) return;

    setError(null);
    try {
      await deleteDoc(doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      setError(err.message || 'Failed to delete document');
    }
  }

  const ownedDocs = docs.filter((d) => d.access === 'owner');
  const sharedDocs = docs.filter((d) => d.access !== 'owner');

  return (
    <div>
      <header className="app-header">
        <div className="app-brand">Ajaia Docs</div>
        <div className="header-user-info">
          <span>Logged in as <strong className="header-user-name">{user?.name || user?.email}</strong></span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="main-container">
        {error && <div className="error-banner">{error}</div>}

        <div className="dashboard-actions-bar">
          <div className="action-buttons-group">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleNewDoc}
              disabled={actionLoading}
            >
              + New document
            </button>

            <div className="upload-container">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleUploadClick}
                disabled={actionLoading}
              >
                Upload file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.docx"
                style={{ display: 'none' }}
                onChange={handleFileSelected}
              />
              <span className="upload-note">
                Supported: .txt, .md, .docx, up to 2 MB. Uploading creates a new document.
              </span>
            </div>
          </div>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading documents...</p>
        ) : (
          <>
            {/* Section 1: Owned by me */}
            <section className="dashboard-section">
              <h2 className="section-title">
                Owned by me
                <span className="section-count">{ownedDocs.length}</span>
              </h2>

              {ownedDocs.length === 0 ? (
                <div className="empty-state">No documents created by you yet.</div>
              ) : (
                <div className="document-grid">
                  {ownedDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="doc-card"
                      onClick={() => onOpenDoc(doc.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          onOpenDoc(doc.id);
                        }
                      }}
                    >
                      <div>
                        <div className="doc-card-header">
                          <span className="doc-card-title">{doc.title}</span>
                          <span className="badge badge-owner">{formatAccessRole(doc.access)}</span>
                        </div>
                        <div className="doc-card-meta">
                          <span>Owner: {doc.owner_name}</span>
                          <span>Last updated: {formatDate(doc.updated_at)}</span>
                        </div>
                      </div>

                      <div className="doc-card-footer">
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={(e) => handleDeleteDoc(e, doc)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Section 2: Shared with me */}
            <section className="dashboard-section">
              <h2 className="section-title">
                Shared with me
                <span className="section-count">{sharedDocs.length}</span>
              </h2>

              {sharedDocs.length === 0 ? (
                <div className="empty-state">No documents shared with you yet.</div>
              ) : (
                <div className="document-grid">
                  {sharedDocs.map((doc) => {
                    const roleLabel = formatAccessRole(doc.access);
                    const badgeClass = doc.access === 'editor' ? 'badge-editor' : 'badge-viewer';
                    return (
                      <div
                        key={doc.id}
                        className="doc-card"
                        onClick={() => onOpenDoc(doc.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            onOpenDoc(doc.id);
                          }
                        }}
                      >
                        <div>
                          <div className="doc-card-header">
                            <span className="doc-card-title">{doc.title}</span>
                            <span className={`badge ${badgeClass}`}>{roleLabel}</span>
                          </div>
                          <div className="doc-card-meta">
                            <span>Owner: {doc.owner_name}</span>
                            <span>Last updated: {formatDate(doc.updated_at)}</span>
                          </div>
                        </div>
                        <div className="doc-card-footer" style={{ borderTop: 'none' }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
