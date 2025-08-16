// index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const testUserRoutes = require('./routes/testUserRoutes');
const { connectDB } = require('./db');

const app = express();

// --- Config ---
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// --- Healthcheck ---
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// --- routes go here ---
app.use('/api/test-user', require('./routes/testUserRoutes'));

// 404 handler (keep after routes)
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler (last)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Server error' });
});

// --- DB + Server bootstrap ---
async function start() {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\nReceived ${signal}, closing server...`);
      server.close(async () => {
        try {
          await mongoose.connection.close();
          console.log('🔌 Mongo connection closed');
        } catch (e) {
          console.error('Error closing Mongo connection:', e);
        } finally {
          process.exit(0);
        }
      });
      // Safety net in case server doesn't close in time
      setTimeout(() => process.exit(1), 8000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

start();