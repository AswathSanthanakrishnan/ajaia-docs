import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import mammoth from 'mammoth';
import { authenticate, createSession } from './auth.js';

/**
 * Higher-order helper to wrap async route handlers and forward unhandled errors to Express error handler.
 * Prevents server crashes on bad requests or unexpected exceptions.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Configure multer memory storage with a 2 MB file size limit.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 // 2 MB
  }
});

/**
 * Wraps upload.single('file') to return friendly 400 JSON errors on upload failures (like size limits).
 */
function uploadMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds 2 MB limit' });
      }
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    next();
  });
}

/**
 * Converts plain text into a TipTap document JSON string with paragraph nodes.
 * @param {string} text
 * @returns {string} Serialized TipTap JSON
 */
function textToTipTapJson(text) {
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

  return JSON.stringify({
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }]
  });
}

/**
 * Creates and configures the Express API router.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Router}
 */
export function createRoutes(db) {
  const router = Router();

  // -------------------------------------------------------------
  // Public Route: Authentication Login
  // -------------------------------------------------------------
  router.post(
    '/auth/login',
    asyncHandler(async (req, res) => {
      const { email, password } = req.body || {};

      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: 'Email is required' });
      }
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Password is required' });
      }

      const user = db
        .prepare('SELECT id, name, email, password FROM users WHERE LOWER(email) = LOWER(?)')
        .get(email.trim());

      // Check credentials (plain text demo passwords per spec)
      if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Generate session token and persist
      const token = createSession(db, user.id);

      return res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });
    })
  );

  // -------------------------------------------------------------
  // Protected Routes: All subsequent routes require a valid Bearer token
  // -------------------------------------------------------------
  router.use(authenticate(db));

  // GET /api/me - Returns current authenticated user
  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      return res.json(req.user);
    })
  );

  // GET /api/docs - Lists documents owned by user or shared with user
  router.get(
    '/docs',
    asyncHandler(async (req, res) => {
      const docs = db
        .prepare(
          `
          SELECT
            d.id,
            d.title,
            d.updated_at,
            u.name AS owner_name,
            CASE
              WHEN d.owner_id = ? THEN 'owner'
              ELSE s.role
            END AS access
          FROM documents d
          JOIN users u ON d.owner_id = u.id
          LEFT JOIN shares s ON s.document_id = d.id AND s.user_id = ?
          WHERE d.owner_id = ? OR s.user_id = ?
          ORDER BY d.updated_at DESC
        `
        )
        .all(req.user.id, req.user.id, req.user.id, req.user.id);

      return res.json(docs);
    })
  );

  // POST /api/docs - Creates an empty document owned by user
  router.post(
    '/docs',
    asyncHandler(async (req, res) => {
      const { title } = req.body || {};
      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const emptyContentJson = JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph' }]
      });
      const emptyContentText = '';

      db.prepare(
        `
        INSERT INTO documents (id, owner_id, title, content_json, content_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(id, req.user.id, title.trim(), emptyContentJson, emptyContentText, now, now);

      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);

      return res.status(201).json({
        ...doc,
        owner_name: req.user.name,
        access: 'owner'
      });
    })
  );

  // GET /api/docs/:id - Returns document if owned or shared, else 404 (do not leak existence)
  router.get(
    '/docs/:id',
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      const doc = db
        .prepare(
          `
          SELECT
            d.id,
            d.owner_id,
            d.title,
            d.content_json,
            d.content_text,
            d.created_at,
            d.updated_at,
            u.name AS owner_name,
            CASE
              WHEN d.owner_id = ? THEN 'owner'
              ELSE s.role
            END AS access
          FROM documents d
          JOIN users u ON d.owner_id = u.id
          LEFT JOIN shares s ON s.document_id = d.id AND s.user_id = ?
          WHERE d.id = ? AND (d.owner_id = ? OR s.user_id = ?)
        `
        )
        .get(req.user.id, req.user.id, id, req.user.id, req.user.id);

      // Do not leak existence if document doesn't exist or user lacks access
      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      return res.json(doc);
    })
  );

  // PATCH /api/docs/:id - Updates title and content; viewers get 403
  router.patch(
    '/docs/:id',
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      // Check document existence and access role for the current user
      const doc = db
        .prepare(
          `
          SELECT
            d.id,
            d.owner_id,
            d.title,
            d.content_json,
            d.content_text,
            CASE
              WHEN d.owner_id = ? THEN 'owner'
              ELSE s.role
            END AS access
          FROM documents d
          LEFT JOIN shares s ON s.document_id = d.id AND s.user_id = ?
          WHERE d.id = ? AND (d.owner_id = ? OR s.user_id = ?)
        `
        )
        .get(req.user.id, req.user.id, id, req.user.id, req.user.id);

      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      if (doc.access === 'viewer') {
        return res.status(403).json({ error: 'Forbidden: Viewers cannot edit this document' });
      }

      const { title, content_json, content_text } = req.body || {};
      if (title === undefined && content_json === undefined && content_text === undefined) {
        return res.status(400).json({ error: 'At least one field (title, content_json, content_text) must be provided' });
      }

      if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
        return res.status(400).json({ error: 'Title cannot be empty' });
      }

      // Convert content_json to string if sent as an object
      let serializedContentJson = content_json;
      if (typeof content_json === 'object' && content_json !== null) {
        serializedContentJson = JSON.stringify(content_json);
      }

      const newTitle = title !== undefined ? title.trim() : doc.title;
      const newContentJson = serializedContentJson !== undefined ? serializedContentJson : doc.content_json;
      const newContentText = content_text !== undefined ? String(content_text) : doc.content_text;
      const now = new Date().toISOString();

      db.prepare(
        `
        UPDATE documents
        SET title = ?, content_json = ?, content_text = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(newTitle, newContentJson, newContentText, now, id);

      const updated = db
        .prepare(
          `
          SELECT
            d.id,
            d.owner_id,
            d.title,
            d.content_json,
            d.content_text,
            d.created_at,
            d.updated_at,
            u.name AS owner_name,
            ? AS access
          FROM documents d
          JOIN users u ON d.owner_id = u.id
          WHERE d.id = ?
        `
        )
        .get(doc.access, id);

      return res.json(updated);
    })
  );

  // DELETE /api/docs/:id - Deletes document and its shares (owner only)
  router.delete(
    '/docs/:id',
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      const doc = db.prepare('SELECT id, owner_id FROM documents WHERE id = ?').get(id);
      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Enforce owner-only deletion
      if (doc.owner_id !== req.user.id) {
        // If caller is an editor or viewer, return 403; otherwise 404 to avoid leaking existence
        const share = db.prepare('SELECT id FROM shares WHERE document_id = ? AND user_id = ?').get(id, req.user.id);
        if (!share) {
          return res.status(404).json({ error: 'Document not found' });
        }
        return res.status(403).json({ error: 'Forbidden: Only the owner can delete this document' });
      }

      // Explicitly delete shares and document
      db.prepare('DELETE FROM shares WHERE document_id = ?').run(id);
      db.prepare('DELETE FROM documents WHERE id = ?').run(id);

      return res.json({ message: 'Document deleted successfully' });
    })
  );

  // POST /api/docs/:id/share - Shares document with a user; owner only
  router.post(
    '/docs/:id/share',
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      const doc = db.prepare('SELECT id, owner_id FROM documents WHERE id = ?').get(id);
      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      if (doc.owner_id !== req.user.id) {
        const share = db.prepare('SELECT id FROM shares WHERE document_id = ? AND user_id = ?').get(id, req.user.id);
        if (!share) {
          return res.status(404).json({ error: 'Document not found' });
        }
        return res.status(403).json({ error: 'Forbidden: Only the owner can share this document' });
      }

      const { email, role } = req.body || {};
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: 'Email is required' });
      }
      if (!role || (role !== 'editor' && role !== 'viewer')) {
        return res.status(400).json({ error: "Role must be 'editor' or 'viewer'" });
      }

      const targetUser = db
        .prepare('SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?)')
        .get(email.trim());

      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (targetUser.id === doc.owner_id) {
        return res.status(400).json({ error: 'Cannot share document with the owner' });
      }

      // Check if already shared; update role if so
      const existingShare = db
        .prepare('SELECT id, document_id, user_id, role FROM shares WHERE document_id = ? AND user_id = ?')
        .get(id, targetUser.id);

      if (existingShare) {
        db.prepare('UPDATE shares SET role = ? WHERE id = ?').run(role, existingShare.id);
        const updatedShare = db.prepare('SELECT id, document_id, user_id, role FROM shares WHERE id = ?').get(existingShare.id);
        return res.json({
          ...updatedShare,
          name: targetUser.name,
          email: targetUser.email
        });
      }

      // Insert new share
      const info = db.prepare('INSERT INTO shares (document_id, user_id, role) VALUES (?, ?, ?)').run(id, targetUser.id, role);
      const newShare = db.prepare('SELECT id, document_id, user_id, role FROM shares WHERE id = ?').get(info.lastInsertRowid);

      return res.json({
        ...newShare,
        name: targetUser.name,
        email: targetUser.email
      });
    })
  );

  // GET /api/docs/:id/shares - Lists shares with user name, email, role (owner only)
  router.get(
    '/docs/:id/shares',
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      const doc = db.prepare('SELECT id, owner_id FROM documents WHERE id = ?').get(id);
      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      if (doc.owner_id !== req.user.id) {
        const share = db.prepare('SELECT id FROM shares WHERE document_id = ? AND user_id = ?').get(id, req.user.id);
        if (!share) {
          return res.status(404).json({ error: 'Document not found' });
        }
        return res.status(403).json({ error: 'Forbidden: Only the owner can view shares' });
      }

      const shares = db
        .prepare(
          `
          SELECT
            s.id,
            s.document_id,
            s.user_id,
            s.role,
            u.name,
            u.email
          FROM shares s
          JOIN users u ON s.user_id = u.id
          WHERE s.document_id = ?
          ORDER BY s.id ASC
        `
        )
        .all(id);

      return res.json(shares);
    })
  );

  // DELETE /api/docs/:id/share/:userId - Removes a user share (owner only)
  router.delete(
    '/docs/:id/share/:userId',
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const targetUserId = Number(req.params.userId);

      if (!targetUserId || isNaN(targetUserId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }

      const doc = db.prepare('SELECT id, owner_id FROM documents WHERE id = ?').get(id);
      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      if (doc.owner_id !== req.user.id) {
        const share = db.prepare('SELECT id FROM shares WHERE document_id = ? AND user_id = ?').get(id, req.user.id);
        if (!share) {
          return res.status(404).json({ error: 'Document not found' });
        }
        return res.status(403).json({ error: 'Forbidden: Only the owner can manage shares' });
      }

      const share = db
        .prepare('SELECT id FROM shares WHERE document_id = ? AND user_id = ?')
        .get(id, targetUserId);

      if (!share) {
        return res.status(404).json({ error: 'Share not found' });
      }

      db.prepare('DELETE FROM shares WHERE id = ?').run(share.id);
      return res.json({ message: 'Share removed successfully' });
    })
  );

  // POST /api/upload - Uploads .txt, .md, or .docx file and creates a new document
  router.post(
    '/upload',
    uploadMiddleware,
    asyncHandler(async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'File is required' });
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      const allowedExtensions = ['.txt', '.md', '.docx'];

      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({
          error: "Unsupported file type. Only .txt, .md, and .docx files are allowed."
        });
      }

      let extractedText = '';

      if (ext === '.txt' || ext === '.md') {
        extractedText = req.file.buffer.toString('utf-8');
      } else if (ext === '.docx') {
        try {
          const mammothResult = await mammoth.extractRawText({ buffer: req.file.buffer });
          extractedText = mammothResult.value;
        } catch (docxError) {
          return res.status(400).json({ error: 'Failed to extract text from .docx file' });
        }
      }

      // Title derived from file name without extension
      const title = path.basename(req.file.originalname, ext).trim() || 'Untitled Document';
      const content_json = textToTipTapJson(extractedText);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO documents (id, owner_id, title, content_json, content_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(id, req.user.id, title, content_json, extractedText, now, now);

      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);

      return res.status(201).json({
        ...doc,
        owner_name: req.user.name,
        access: 'owner'
      });
    })
  );

  return router;
}

export default createRoutes;
