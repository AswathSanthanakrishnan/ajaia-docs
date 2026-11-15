import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { initDb } from '../src/db.js';

describe('Ajaia Docs API Tests', () => {
  let db;
  let app;
  let tempDbPath;

  beforeEach(() => {
    // Generate an isolated temporary SQLite database file for each test
    tempDbPath = path.join(os.tmpdir(), `test-ajaia-${crypto.randomUUID()}.db`);
    db = initDb(tempDbPath);
    app = createApp(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    // Clean up temporary database and SQLite WAL/SHM files
    if (tempDbPath && fs.existsSync(tempDbPath)) {
      try {
        fs.unlinkSync(tempDbPath);
      } catch {}
      try {
        fs.unlinkSync(`${tempDbPath}-wal`);
      } catch {}
      try {
        fs.unlinkSync(`${tempDbPath}-shm`);
      } catch {}
    }
  });

  // Helper to quickly log in a demo user
  async function login(email, password = 'demo1234') {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    return res.body.token;
  }

  // -------------------------------------------------------------
  // PRIMARY REQUIREMENT: Sharing rule end-to-end test
  // -------------------------------------------------------------
  it('covers the sharing rule end to end: Maya creates doc -> Priya 404 -> viewer 200/403 -> editor 200', async () => {
    // 1. Authenticate Maya and Priya
    const mayaToken = await login('maya@demo.io', 'demo1234');
    const priyaToken = await login('priya@demo.io', 'demo1234');

    expect(mayaToken).toBeDefined();
    expect(priyaToken).toBeDefined();

    // 2. Maya creates a doc
    const createRes = await request(app)
      .post('/api/docs')
      .set('Authorization', `Bearer ${mayaToken}`)
      .send({ title: 'Maya Confidential Architecture' })
      .expect(201);

    const docId = createRes.body.id;
    expect(docId).toBeDefined();
    expect(createRes.body.title).toBe('Maya Confidential Architecture');
    expect(createRes.body.access).toBe('owner');

    // 3. Priya cannot read it (404 - existence is not leaked)
    const priyaGetBefore = await request(app)
      .get(`/api/docs/${docId}`)
      .set('Authorization', `Bearer ${priyaToken}`)
      .expect(404);

    expect(priyaGetBefore.body.error).toBe('Document not found');

    // 4. Maya shares it to Priya as viewer
    const shareViewerRes = await request(app)
      .post(`/api/docs/${docId}/share`)
      .set('Authorization', `Bearer ${mayaToken}`)
      .send({ email: 'priya@demo.io', role: 'viewer' })
      .expect(200);

    expect(shareViewerRes.body.role).toBe('viewer');
    expect(shareViewerRes.body.document_id).toBe(docId);

    // 5. Priya can read it (200)
    const priyaGetViewer = await request(app)
      .get(`/api/docs/${docId}`)
      .set('Authorization', `Bearer ${priyaToken}`)
      .expect(200);

    expect(priyaGetViewer.body.id).toBe(docId);
    expect(priyaGetViewer.body.title).toBe('Maya Confidential Architecture');
    expect(priyaGetViewer.body.access).toBe('viewer');

    // 6. Priya cannot PATCH it (403)
    const priyaPatchForbidden = await request(app)
      .patch(`/api/docs/${docId}`)
      .set('Authorization', `Bearer ${priyaToken}`)
      .send({ title: 'Priya Unauthorized Edit' })
      .expect(403);

    expect(priyaPatchForbidden.body.error).toMatch(/viewers cannot edit/i);

    // 7. Maya upgrades Priya to editor (re-sharing with editor role updates existing share)
    const upgradeRes = await request(app)
      .post(`/api/docs/${docId}/share`)
      .set('Authorization', `Bearer ${mayaToken}`)
      .send({ email: 'priya@demo.io', role: 'editor' })
      .expect(200);

    expect(upgradeRes.body.role).toBe('editor');

    // 8. Priya can PATCH (200)
    const priyaPatchSuccess = await request(app)
      .patch(`/api/docs/${docId}`)
      .set('Authorization', `Bearer ${priyaToken}`)
      .send({
        title: 'Maya Confidential Architecture (Reviewed by Priya)',
        content_text: 'Priya added comments and suggestions.'
      })
      .expect(200);

    expect(priyaPatchSuccess.body.title).toBe('Maya Confidential Architecture (Reviewed by Priya)');
    expect(priyaPatchSuccess.body.content_text).toBe('Priya added comments and suggestions.');
    expect(priyaPatchSuccess.body.access).toBe('editor');
  });

  // -------------------------------------------------------------
  // Seeded Demo Accounts & Initial Document
  // -------------------------------------------------------------
  describe('Seeded Data', () => {
    it('seeds exactly three demo users and one sample doc shared to Jordan as editor', async () => {
      // Verify Maya
      const mayaLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'maya@demo.io', password: 'demo1234' })
        .expect(200);
      expect(mayaLogin.body.user.name).toBe('Maya Chen');

      // Verify Jordan
      const jordanLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'jordan@demo.io', password: 'demo1234' })
        .expect(200);
      expect(jordanLogin.body.user.name).toBe('Jordan Lee');

      // Verify Priya
      const priyaLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'priya@demo.io', password: 'demo1234' })
        .expect(200);
      expect(priyaLogin.body.user.name).toBe('Priya Nair');

      // Check Jordan's document list - should contain the seeded document with editor access
      const jordanDocs = await request(app)
        .get('/api/docs')
        .set('Authorization', `Bearer ${jordanLogin.body.token}`)
        .expect(200);

      expect(jordanDocs.body.length).toBe(1);
      const sampleDoc = jordanDocs.body[0];
      expect(sampleDoc.title).toBe('Welcome to Ajaia Docs');
      expect(sampleDoc.owner_name).toBe('Maya Chen');
      expect(sampleDoc.access).toBe('editor');

      // Priya has not been shared on the sample doc, so her doc list is empty
      const priyaDocs = await request(app)
        .get('/api/docs')
        .set('Authorization', `Bearer ${priyaLogin.body.token}`)
        .expect(200);

      expect(priyaDocs.body.length).toBe(0);
    });
  });

  // -------------------------------------------------------------
  // Authentication & Validation
  // -------------------------------------------------------------
  describe('Authentication', () => {
    it('rejects login with missing email or password with 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'maya@demo.io' })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('rejects login with bad credentials with 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'maya@demo.io', password: 'wrongpassword' })
        .expect(401);

      expect(res.body.error).toBe('Invalid email or password');
    });

    it('returns current user on GET /api/me with valid token', async () => {
      const token = await login('maya@demo.io');
      const res = await request(app)
        .get('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.email).toBe('maya@demo.io');
      expect(res.body.name).toBe('Maya Chen');
    });

    it('rejects protected routes with 401 when token is missing or invalid', async () => {
      await request(app)
        .get('/api/me')
        .expect(401);

      await request(app)
        .get('/api/docs')
        .set('Authorization', 'Bearer invalid-token-value')
        .expect(401);
    });
  });

  // -------------------------------------------------------------
  // Document Operations & Deletion
  // -------------------------------------------------------------
  describe('Document Operations', () => {
    it('validates document creation requires title', async () => {
      const token = await login('maya@demo.io');
      const res = await request(app)
        .post('/api/docs')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);

      expect(res.body.error).toBe('Title is required');
    });

    it('allows owner to delete document and deletes its shares', async () => {
      const mayaToken = await login('maya@demo.io');
      const jordanToken = await login('jordan@demo.io');

      // Create a doc
      const docRes = await request(app)
        .post('/api/docs')
        .set('Authorization', `Bearer ${mayaToken}`)
        .send({ title: 'Doc to Delete' })
        .expect(201);
      const docId = docRes.body.id;

      // Share to Jordan
      await request(app)
        .post(`/api/docs/${docId}/share`)
        .set('Authorization', `Bearer ${mayaToken}`)
        .send({ email: 'jordan@demo.io', role: 'editor' })
        .expect(200);

      // Jordan cannot delete the document (403)
      await request(app)
        .delete(`/api/docs/${docId}`)
        .set('Authorization', `Bearer ${jordanToken}`)
        .expect(403);

      // Maya deletes the document (200)
      await request(app)
        .delete(`/api/docs/${docId}`)
        .set('Authorization', `Bearer ${mayaToken}`)
        .expect(200);

      // Verify document no longer exists
      await request(app)
        .get(`/api/docs/${docId}`)
        .set('Authorization', `Bearer ${mayaToken}`)
        .expect(404);

      // Verify shares are removed from database
      const remainingShares = db.prepare('SELECT * FROM shares WHERE document_id = ?').all(docId);
      expect(remainingShares.length).toBe(0);
    });
  });

  // -------------------------------------------------------------
  // Share Management
  // -------------------------------------------------------------
  describe('Share Management', () => {
    it('allows owner to list and delete shares, rejects invalid share actions', async () => {
      const mayaToken = await login('maya@demo.io');
      const jordanToken = await login('jordan@demo.io');

      const docRes = await request(app)
        .post('/api/docs')
        .set('Authorization', `Bearer ${mayaToken}`)
        .send({ title: 'Sharing Test Doc' })
        .expect(201);
      const docId = docRes.body.id;

      // Cannot share with self (owner)
      const shareSelf = await request(app)
        .post(`/api/docs/${docId}/share`)
        .set('Authorization', `Bearer ${mayaToken}`)
        .send({ email: 'maya@demo.io', role: 'editor' })
        .expect(400);
      expect(shareSelf.body.error).toMatch(/cannot share document with the owner/i);

      // 404 if user email does not exist
      await request(app)
        .post(`/api/docs/${docId}/share`)
        .set('Authorization', `Bearer ${mayaToken}`)
        .send({ email: 'nonexistent@demo.io', role: 'editor' })
        .expect(404);

      // 400 on invalid role
      await request(app)
        .post(`/api/docs/${docId}/share`)
        .set('Authorization', `Bearer ${mayaToken}`)
        .send({ email: 'jordan@demo.io', role: 'admin' })
        .expect(400);

      // Valid share to Jordan
      await request(app)
        .post(`/api/docs/${docId}/share`)
        .set('Authorization', `Bearer ${mayaToken}`)
        .send({ email: 'jordan@demo.io', role: 'viewer' })
        .expect(200);

      // Owner lists shares
      const sharesRes = await request(app)
        .get(`/api/docs/${docId}/shares`)
        .set('Authorization', `Bearer ${mayaToken}`)
        .expect(200);
      expect(sharesRes.body.length).toBe(1);
      expect(sharesRes.body[0].email).toBe('jordan@demo.io');

      // Non-owner cannot list shares
      await request(app)
        .get(`/api/docs/${docId}/shares`)
        .set('Authorization', `Bearer ${jordanToken}`)
        .expect(403);

      const jordanUserId = sharesRes.body[0].user_id;

      // Owner deletes share
      await request(app)
        .delete(`/api/docs/${docId}/share/${jordanUserId}`)
        .set('Authorization', `Bearer ${mayaToken}`)
        .expect(200);

      // Jordan no longer has access
      await request(app)
        .get(`/api/docs/${docId}`)
        .set('Authorization', `Bearer ${jordanToken}`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------
  // File Upload
  // -------------------------------------------------------------
  describe('File Upload', () => {
    it('uploads a .txt file and creates a new document with parsed paragraphs', async () => {
      const token = await login('maya@demo.io');

      const textContent = 'Paragraph 1 line\n\nParagraph 2 line';
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from(textContent, 'utf-8'), 'Meeting-Notes.txt')
        .expect(201);

      expect(res.body.title).toBe('Meeting-Notes');
      expect(res.body.content_text).toBe(textContent);
      expect(res.body.access).toBe('owner');

      const parsedJson = JSON.parse(res.body.content_json);
      expect(parsedJson.type).toBe('doc');
      expect(parsedJson.content.length).toBeGreaterThan(0);
    });

    it('uploads a .md file successfully', async () => {
      const token = await login('maya@demo.io');

      const mdContent = '# Markdown Title\nSome content';
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from(mdContent, 'utf-8'), 'Readme.md')
        .expect(201);

      expect(res.body.title).toBe('Readme');
      expect(res.body.content_text).toBe(mdContent);
    });

    it('rejects unsupported file extensions with 400', async () => {
      const token = await login('maya@demo.io');

      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data', 'utf-8'), 'archive.zip')
        .expect(400);

      expect(res.body.error).toMatch(/Unsupported file type/i);
    });

    it('rejects upload without file with 400', async () => {
      const token = await login('maya@demo.io');

      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(res.body.error).toBe('File is required');
    });

    it('rejects files exceeding 2 MB limit with 400', async () => {
      const token = await login('maya@demo.io');

      // Create a buffer larger than 2 MB (2 * 1024 * 1024 + 100 bytes)
      const largeBuffer = Buffer.alloc(2 * 1024 * 1024 + 100, 'a');

      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', largeBuffer, 'huge.txt')
        .expect(400);

      expect(res.body.error).toMatch(/exceeds 2 MB limit/i);
    });
  });
});
