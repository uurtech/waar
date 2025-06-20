import { Router } from 'express';
import { analysisRoutes } from './analysis.js';
import { questionsRoutes } from './questions.js';
import { mcpRoutes } from './mcp.js';
import { healthRoutes } from './health.js';
import { wellArchitectedReviewRoutes } from './well-architected-review.js';
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
  app.use('/api/review', wellArchitectedReviewRoutes);

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
        review: {
          'POST /api/review/start': 'Start a new Well-Architected Review (AWS API-based)',
          'POST /api/review/:sessionId/answer': 'Submit answer to a Well-Architected question',
          'GET /api/review/:sessionId/status': 'Get review progress and next question',
          'GET /api/review/:sessionId/report': 'Get final Well-Architected report',
          'GET /api/review/aws-analysis': 'Get comprehensive AWS analysis data'
        },
        analysis: {
          'POST /api/analysis/analyze-iac': 'Analyze Infrastructure as Code templates (deprecated)',
          'POST /api/analysis/analyze': 'Analyze general codebase (deprecated)',
          'POST /api/analysis/upload': 'Upload codebase for analysis (deprecated)',
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