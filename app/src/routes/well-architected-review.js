import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { WellArchitectedReviewService } from '../services/well-architected-review.js';

const router = Router();

// Start a new Well-Architected Review
router.post('/start', async (req, res) => {
  try {
    const sessionId = uuidv4();
    const awsService = req.app.locals.awsService();
    const bedrockService = req.app.locals.bedrockService();
    const logger = req.app.locals.logger;
    const db = req.app.locals.db;

    logger.info(`🚀 Starting Well-Architected Review session ${sessionId}`);

    // Create session immediately and return
    await db.run(
      'INSERT INTO analysis_sessions (id, analysis_status, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [sessionId, 'processing']
    );

    // Start the review process asynchronously
    const reviewService = new WellArchitectedReviewService(awsService, bedrockService);
    reviewService.startReview(sessionId).catch(error => {
      logger.error(`Review ${sessionId} failed:`, error);
      db.run(
        'UPDATE analysis_sessions SET analysis_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['failed', sessionId]
      );
    });

    // Return immediately so the frontend can start polling for progress
    res.json({
      success: true,
      message: 'Well-Architected Review started successfully',
      sessionId: sessionId,
      status: 'processing'
    });

  } catch (error) {
    req.app.locals.logger.error('Failed to start Well-Architected Review:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Submit an answer to a question
router.post('/:sessionId/answer', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { questionKey, answer } = req.body;
    const awsService = req.app.locals.awsService();
    const bedrockService = req.app.locals.bedrockService();
    const logger = req.app.locals.logger;

    if (!questionKey || !answer) {
      return res.status(400).json({
        success: false,
        error: 'Question key and answer are required'
      });
    }

    logger.info(`📝 Processing answer for question ${questionKey} in session ${sessionId}`);

    const reviewService = new WellArchitectedReviewService(awsService, bedrockService);
    const result = await reviewService.submitUserAnswer(sessionId, questionKey, answer);

    res.json({
      success: true,
      message: result.isComplete ? 
        'Review completed! Final report generated.' : 
        `Answer processed. ${result.additionalAnswersCount} additional questions answered automatically.`,
      ...result
    });

  } catch (error) {
    req.app.locals.logger.error('Failed to process answer:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get review status and next question
router.get('/:sessionId/status', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const awsService = req.app.locals.awsService();
    const bedrockService = req.app.locals.bedrockService();

    const reviewService = new WellArchitectedReviewService(awsService, bedrockService);
    const status = await reviewService.getReviewStatus(sessionId);

    res.json({
      success: true,
      ...status
    });

  } catch (error) {
    req.app.locals.logger.error('Failed to get review status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get final report
router.get('/:sessionId/report', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const awsService = req.app.locals.awsService();
    const bedrockService = req.app.locals.bedrockService();

    const reviewService = new WellArchitectedReviewService(awsService, bedrockService);
    const report = await reviewService.getFinalReport(sessionId);

    res.json({
      success: true,
      ...report
    });

  } catch (error) {
    req.app.locals.logger.error('Failed to get final report:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get comprehensive AWS analysis (for debugging/admin)
router.get('/aws-analysis', async (req, res) => {
  try {
    const awsService = req.app.locals.awsService();
    const logger = req.app.locals.logger;

    logger.info('🔍 Running comprehensive AWS analysis');

    const analysis = await awsService.performComprehensiveAnalysis();

    res.json({
      success: true,
      message: 'AWS analysis completed',
      ...analysis
    });

  } catch (error) {
    req.app.locals.logger.error('Failed to perform AWS analysis:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export { router as wellArchitectedReviewRoutes }; 