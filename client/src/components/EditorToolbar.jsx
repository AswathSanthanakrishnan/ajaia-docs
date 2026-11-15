import React from 'react';

export default function EditorToolbar({ editor, isEditable }) {
  if (!editor) {
    return null;
  }

  const disabled = !isEditable;

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Editor toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={`toolbar-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={disabled}
          title="Bold (Ctrl+B / ⌘B)"
        >
          Bold
        </button>
        <button
          type="button"
          className={`toolbar-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={disabled}
          title="Italic (Ctrl+I / ⌘I)"
        >
          Italic
        </button>
        <button
          type="button"
          className={`toolbar-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          disabled={disabled}
          title="Underline (Ctrl+U / ⌘U)"
        >
          Underline
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          type="button"
          className={`toolbar-btn ${editor.isActive('paragraph') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().setParagraph().run()}
          disabled={disabled}
          title="Normal text"
        >
          Normal text
        </button>
        <button
          type="button"
          className={`toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          disabled={disabled}
          title="Heading 1"
        >
          Heading 1
        </button>
        <button
          type="button"
          className={`toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={disabled}
          title="Heading 2"
        >
          Heading 2
        </button>
        <button
          type="button"
          className={`toolbar-btn ${editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          disabled={disabled}
          title="Heading 3"
        >
          Heading 3
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          type="button"
          className={`toolbar-btn ${editor.isActive('bulletList') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          disabled={disabled}
          title="Bullet list"
        >
          Bullet list
        </button>
        <button
          type="button"
          className={`toolbar-btn ${editor.isActive('orderedList') ? 'is-active' : ''}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          disabled={disabled}
          title="Numbered list"
        >
          Numbered list
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={disabled || !editor.can().undo()}
          title="Undo"
        >
          Undo
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={disabled || !editor.can().redo()}
          title="Redo"
        >
          Redo
        </button>
      </div>
    </div>
  );
}
