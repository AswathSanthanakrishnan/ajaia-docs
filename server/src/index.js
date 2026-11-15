import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { createRoutes } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Creates and configures the Express application.
 * Accepts an optional database instance, making it straightforward to test with in-memory or temp SQLite databases.
 *
 * @param {import('node:sqlite').DatabaseSync} [db]
 * @returns {express.Express}
 */
export function createApp(db = getDb()) {
  const app = express();

  // Basic middleware
  app.use(cors());
  app.use(express.json());

  // Mount API endpoints
  app.use('/api', createRoutes(db));

  // Determine static frontend directory (production build of React app)
  // Checks candidate paths to handle running from either repo root or server/ folder
  const candidateDistPaths = [
    path.resolve(__dirname, '../../client/dist'),
    path.resolve(process.cwd(), '../client/dist'),
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(__dirname, '../client/dist')
  ];

  const clientDistPath = candidateDistPaths.find((p) => fs.existsSync(p));

  if (clientDistPath) {
    app.use(express.static(clientDistPath));

    // SPA fallback: return index.html for all non-API navigation requests
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
  }

  // 404 handler for unknown API routes
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Global centralized error handler ensures every error response is { error: "message" }
  // and that unhandled errors do not crash the server
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    console.error('Unhandled application error:', err);
    const status = err.status || 500;
    const message = err.message || 'Internal server error';
    return res.status(status).json({ error: message });
  });

  return app;
}

// Start HTTP server on specified or default port when executed directly
const PORT = process.env.PORT || 8080;

if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Ajaia Docs server listening on port ${PORT}`);
  });
}

export default createApp;
