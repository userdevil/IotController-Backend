import express from 'express';
import cors from 'cors';

import registerRouter from './routes/register.js';
import systemConfigRouter from './routes/systemConfig.js';
import paramConfigRouter from './routes/paramConfig.js';
import dataTransferRouter from './routes/dataTransfer.js';
import relayConfigRouter from './routes/relayConfig.js';
import managementRouter from './routes/management.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Static files (Web Configuration Dashboard)
app.use(express.static('public'));

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[HTTP] ${timestamp} ${req.method} ${req.originalUrl}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/register', registerRouter);
app.use('/api/system-config', systemConfigRouter);
app.use('/api/param-config', paramConfigRouter);
app.use('/api/data', dataTransferRouter);
app.use('/api/relay-config', relayConfigRouter);
app.use('/api/manage', managementRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('[SERVER_ERROR]', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

export default app;
