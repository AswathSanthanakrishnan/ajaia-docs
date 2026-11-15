import crypto from 'node:crypto';

/**
 * Creates an Express authentication middleware using bearer tokens stored in SQLite.
 * Protects endpoints by verifying the token in the Authorization header.
 * Attaches req.user = { id, name, email } and req.token to the request.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {import('express').RequestHandler}
 */
export function authenticate(db) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization header' });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Bearer token is empty' });
    }

    try {
      const session = db.prepare(`
        SELECT s.token, u.id, u.name, u.email
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ?
      `).get(token);

      if (!session) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
      }

      req.user = {
        id: session.id,
        name: session.name,
        email: session.email
      };
      req.token = session.token;
      next();
    } catch (err) {
      return res.status(500).json({ error: 'Authentication check failed' });
    }
  };
}

/**
 * Generates and saves a new bearer token session for the given user ID.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @returns {string} Bearer session token
 */
export function createSession(db, userId) {
  const token = crypto.randomUUID();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}
