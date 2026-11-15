import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { getDoc, updateDoc } from '../api';
import EditorToolbar from '../components/EditorToolbar';
import ShareModal from '../components/ShareModal';

/**
 * Builds TipTap document JSON with paragraph nodes from raw text.
 * Used when a document loads with content_json empty but content_text present (e.g. uploaded files).
 */
function textToTipTapDoc(text) {
  if (!text) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph' }]
    };
  }

  const lines = text.split(/\r?\n/);
  const content = lines.map((line) => {
    if (!line.trim()) {
      return { type: 'paragraph' };
    }
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: line }]
    };
  });

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }]
  };
}

export default function EditorPage({ docId, onBack }) {
  const [doc, setDoc] = useState(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'Saving...' | 'Saved' | 'Save failed'
  const [showShareModal, setShowShareModal] = useState(false);

  const titleRef = useRef('');
  const isLoadedRef = useRef(false);
  const canEditRef = useRef(false);
  const autosaveTimerRef = useRef(null);
  const editorRef = useRef(null);

  const isOwner = doc?.access === 'owner';
  const isEditor = doc?.access === 'editor';
  const isEditable = isOwner || isEditor;
  canEditRef.current = isEditable;

  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline
    ],
    content: '',
    editable: false,
    onUpdate: () => {
      if (!isLoadedRef.current || !canEditRef.current) return;
      scheduleAutosave();
    }
  });

  editorRef.current = editor;

  // Debounced autosave (800 ms)
  function scheduleAutosave(currentTitle = titleRef.current) {
    if (!canEditRef.current) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(async () => {
      setSaveStatus('Saving...');
      try {
        const jsonContent = editorRef.current ? editorRef.current.getJSON() : null;
        const textContent = editorRef.current ? editorRef.current.getText() : '';

        await updateDoc(docId, {
          title: currentTitle.trim() || 'Untitled document',
          content_json: jsonContent,
          content_text: textContent
        });
        setSaveStatus('Saved');
      } catch (err) {
        console.error('Autosave error:', err);
        setSaveStatus('Save failed');
      }
    }, 800);
  }

  // Load document on mount or docId change
  useEffect(() => {
    let isCancelled = false;
    isLoadedRef.current = false;
    setLoading(true);
    setLoadError(null);
    setSaveStatus('');

    async function fetchDocument() {
      try {
        const data = await getDoc(docId);
        if (isCancelled) return;

        setDoc(data);
        setTitle(data.title || 'Untitled document');
        titleRef.current = data.title || 'Untitled document';

        const editable = data.access === 'owner' || data.access === 'editor';
        canEditRef.current = editable;

        // Parse document content
        let initialContent = null;
        if (data.content_json) {
          try {
            const parsed = typeof data.content_json === 'string'
              ? JSON.parse(data.content_json)
              : data.content_json;

            if (parsed && parsed.type === 'doc' && Array.isArray(parsed.content)) {
              // Check if it has actual content
              const hasTextOrNodes = parsed.content.some((node) =>
                node.text || (Array.isArray(node.content) && node.content.length > 0)
              );
              if (hasTextOrNodes) {
                initialContent = parsed;
              }
            }
          } catch {
            initialContent = null;
          }
        }

        // When a document loads with content_json empty but content_text present (uploaded files),
        // build the editor content from the text as paragraphs.
        if (!initialContent && data.content_text) {
          initialContent = textToTipTapDoc(data.content_text);
        }

        if (!initialContent) {
          initialContent = {
            type: 'doc',
            content: [{ type: 'paragraph' }]
          };
        }

        if (editor) {
          editor.commands.setContent(initialContent, false);
          editor.setEditable(editable);
        }

        isLoadedRef.current = true;
      } catch (err) {
        if (!isCancelled) {
          setLoadError(err.message || 'Failed to load document');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    if (docId) {
      fetchDocument();
    }

    return () => {
      isCancelled = true;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [docId, editor]);

  // Handle title changes from inline input
  function handleTitleChange(e) {
    if (!isEditable) return;
    const newTitle = e.target.value;
    setTitle(newTitle);
    titleRef.current = newTitle;
    scheduleAutosave(newTitle);
  }

  const statusClass = saveStatus === 'Saving...' ? 'saving' : saveStatus === 'Saved' ? 'saved' : saveStatus === 'Save failed' ? 'failed' : '';

  if (loading) {
    return (
      <div className="editor-page-wrapper">
        <header className="editor-navbar">
          <button type="button" className="btn-link" onClick={onBack}>
            ← Dashboard
          </button>
        </header>
        <div className="main-container">
          <p style={{ color: 'var(--text-muted)' }}>Loading document...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="editor-page-wrapper">
        <header className="editor-navbar">
          <button type="button" className="btn-link" onClick={onBack}>
            ← Dashboard
          </button>
        </header>
        <div className="main-container">
          <div className="error-banner">{loadError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-page-wrapper">
      {/* Editor Navbar */}
      <header className="editor-navbar">
        <div className="editor-navbar-left">
          <button type="button" className="btn-link" onClick={onBack}>
            ← Dashboard
          </button>

          <div className="editor-title-container">
            <input
              type="text"
              className="doc-title-input"
              value={title}
              onChange={handleTitleChange}
              disabled={!isEditable}
              readOnly={!isEditable}
              aria-label="Document title"
              placeholder="Untitled document"
            />
            {!isEditable && (
              <span className="badge badge-viewer">View only</span>
            )}
          </div>
        </div>

        <div className="editor-navbar-right">
          {saveStatus && (
            <span className={`autosave-status ${statusClass}`}>
              {saveStatus}
            </span>
          )}

          {isOwner && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowShareModal(true)}
            >
              Share
            </button>
          )}
        </div>
      </header>

      {/* Editor Toolbar */}
      <EditorToolbar editor={editor} isEditable={isEditable} />

      {/* Main Document Body */}
      <main className="editor-main-area">
        <div
          className="document-paper"
          onClick={() => {
            if (isEditable && editor) {
              editor.commands.focus();
            }
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </main>

      {/* Share Modal (Owner Only) */}
      {showShareModal && isOwner && (
        <ShareModal
          docId={docId}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}
