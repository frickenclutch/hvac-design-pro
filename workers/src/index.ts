import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { projectRoutes } from './routes/projects';
import { calcRoutes } from './routes/calculations';
import { uploadRoutes } from './routes/uploads';
import { cadRoutes } from './routes/cad';
import { orgRoutes } from './routes/org';
import { feedbackRoutes } from './routes/feedback';
import { authMiddleware } from './middleware/auth';

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  ENVIRONMENT: string;
  RESEND_API_KEY?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  CF_ACCESS_ISSUER?: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS for frontend
app.use('*', cors({
  origin: ['https://hvac-design-pro.pages.dev', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', env: c.env.ENVIRONMENT }));

// Public auth routes
app.route('/api/auth', authRoutes);

// Protected routes
app.use('/api/*', authMiddleware);
app.route('/api/org', orgRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/calculations', calcRoutes);
app.route('/api/uploads', uploadRoutes);
app.route('/api/cad', cadRoutes);
app.route('/api/feedback', feedbackRoutes);

export default app;
