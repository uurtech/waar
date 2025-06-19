import { Router } from 'express';
import { analysisRoutes } from './analysis.js';
import { questionsRoutes } from './questions.js';
import { mcpRoutes } from './mcp.js';
import { healthRoutes } from './health.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const setupRoutes = (app) => {
  // API routes
  app.use('/api/analysis', analysisRoutes);
  app.use('/api/questions', questionsRoutes);
  app.use('/api/mcp', mcpRoutes);
  app.use('/api/health', healthRoutes);

  // Serve main application
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  // API documentation
  app.get('/api', (req, res) => {
    res.json({
      name: 'Well-Architected Reviewer API',
      version: '1.0.0',
      endpoints: {
        analysis: {
          'POST /api/analysis/upload': 'Upload codebase for analysis',
          'GET /api/analysis/:sessionId': 'Get analysis results',
          'POST /api/analysis/:sessionId/answer': 'Submit answer to question'
        },
        questions: {
          'GET /api/questions': 'Get all Well-Architected questions',
          'GET /api/questions/pillars': 'Get all pillars',
          'POST /api/questions/answer': 'Submit answer to question'
        },
        mcp: {
          'GET /api/mcp/cost': 'Get cost analysis',
          'GET /api/mcp/iam': 'Get IAM analysis',
          'GET /api/mcp/compute': 'Get compute analysis'
        },
        health: {
          'GET /api/health': 'Check service health',
          'GET /api/health/aws': 'Check AWS connection',
          'GET /api/health/bedrock': 'Check Bedrock connection'
        }
      }
    });
  });
}; 