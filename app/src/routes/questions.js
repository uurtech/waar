import { Router } from 'express';
import db from '../database/init.js';

const router = Router();

// Get all pillars
router.get('/pillars', async (req, res) => {
  try {
    const pillars = await db.all('SELECT * FROM pillars ORDER BY name');
    
    res.json({
      success: true,
      pillars
    });
  } catch (error) {
    req.app.locals.logger.error('Get pillars error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all questions
router.get('/', async (req, res) => {
  try {
    const { pillar, category } = req.query;
    let query = `
      SELECT q.*, p.name as pillar_name, p.description as pillar_description
      FROM questions q
      JOIN pillars p ON q.pillar_id = p.id
    `;
    const params = [];

    if (pillar) {
      query += ' WHERE p.name = ?';
      params.push(pillar);
    }

    if (category) {
      query += pillar ? ' AND q.category = ?' : ' WHERE q.category = ?';
      params.push(category);
    }

    query += ' ORDER BY p.name, q.category, q.priority';

    const questions = await db.all(query, params);
    
    res.json({
      success: true,
      questions
    });
  } catch (error) {
    req.app.locals.logger.error('Get questions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get questions by pillar
router.get('/pillar/:pillarName', async (req, res) => {
  try {
    const { pillarName } = req.params;
    
    const questions = await db.all(`
      SELECT q.*, p.name as pillar_name, p.description as pillar_description
      FROM questions q
      JOIN pillars p ON q.pillar_id = p.id
      WHERE p.name = ?
      ORDER BY q.category, q.priority
    `, [pillarName]);
    
    res.json({
      success: true,
      questions
    });
  } catch (error) {
    req.app.locals.logger.error('Get pillar questions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get question by key
router.get('/:questionKey', async (req, res) => {
  try {
    const { questionKey } = req.params;
    
    const question = await db.get(`
      SELECT q.*, p.name as pillar_name, p.description as pillar_description
      FROM questions q
      JOIN pillars p ON q.pillar_id = p.id
      WHERE q.question_key = ?
    `, [questionKey]);
    
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    res.json({
      success: true,
      question
    });
  } catch (error) {
    req.app.locals.logger.error('Get question error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit answer to question with agent analysis
router.post('/answer', async (req, res) => {
  try {
    const { questionKey, sessionId, answer, confidence, source = 'user' } = req.body;

    if (!questionKey || !sessionId || !answer) {
      return res.status(400).json({ 
        error: 'Question key, session ID, and answer are required' 
      });
    }

    // Get question details
    const question = await db.get(`
      SELECT q.*, p.name as pillar_name
      FROM questions q
      JOIN pillars p ON q.pillar_id = p.id
      WHERE q.question_key = ?
    `, [questionKey]);

    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Save the answer first
    await db.run(
      `INSERT INTO answers (question_id, session_id, answer_text, confidence_score, source, updated_at) 
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(question_id, session_id) DO UPDATE SET 
       answer_text = excluded.answer_text,
       confidence_score = excluded.confidence_score,
       source = excluded.source,
       updated_at = CURRENT_TIMESTAMP`,
      [question.id, sessionId, answer, confidence || 0.8, source]
    );

    // Ask agent to analyze this specific answer
    let agentAnalysis = null;
    try {
      const bedrockService = req.app.locals.bedrockService();
      
      const analysisPrompt = `
Analyze this Well-Architected Framework answer:

Pillar: ${question.pillar_name}
Question: ${question.question_text}
Category: ${question.category}
User Answer: ${answer}

Please provide:
1. Assessment of the answer quality
2. Specific recommendations for improvement
3. Follow-up questions to dig deeper
4. Risk areas to investigate
5. Best practices suggestions

Keep response concise but actionable.
      `;

      agentAnalysis = await bedrockService.analyzeText(analysisPrompt);
      
    } catch (agentError) {
      req.app.locals.logger.warn('Agent analysis failed:', agentError.message);
      agentAnalysis = {
        error: 'Agent analysis unavailable',
        message: 'Could not analyze answer with AI agent'
      };
    }

    res.json({
      success: true,
      message: 'Answer saved and analyzed successfully',
      agentAnalysis,
      question: {
        key: question.question_key,
        text: question.question_text,
        pillar: question.pillar_name,
        category: question.category
      }
    });

  } catch (error) {
    req.app.locals.logger.error('Save answer error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get answers for a session
router.get('/session/:sessionId/answers', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const answers = await db.all(`
      SELECT 
        q.question_key,
        q.question_text,
        q.category,
        p.name as pillar_name,
        a.answer_text,
        a.confidence_score,
        a.source,
        a.created_at,
        a.updated_at
      FROM answers a
      JOIN questions q ON a.question_id = q.id
      JOIN pillars p ON q.pillar_id = p.id
      WHERE a.session_id = ?
      ORDER BY p.name, q.category, q.priority
    `, [sessionId]);
    
    res.json({
      success: true,
      answers
    });
  } catch (error) {
    req.app.locals.logger.error('Get session answers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get next unanswered question for a session (one at a time)
router.get('/session/:sessionId/next', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Get the next unanswered question with highest priority
    const nextQuestion = await db.get(`
      SELECT 
        q.id,
        q.question_key,
        q.question_text,
        q.category,
        p.name as pillar_name,
        p.description as pillar_description,
        q.priority
      FROM questions q
      JOIN pillars p ON q.pillar_id = p.id
      LEFT JOIN answers a ON q.id = a.question_id AND a.session_id = ?
      WHERE a.id IS NULL
      ORDER BY q.priority DESC, p.name, q.category
      LIMIT 1
    `, [sessionId]);
    
    if (!nextQuestion) {
      // Get completion stats
      const stats = await db.get(`
        SELECT 
          COUNT(DISTINCT q.id) as total_questions,
          COUNT(DISTINCT a.question_id) as answered_questions
        FROM questions q
        LEFT JOIN answers a ON q.id = a.question_id AND a.session_id = ?
      `, [sessionId]);
      
      return res.json({
        success: true,
        completed: true,
        message: 'All questions have been answered!',
        stats
      });
    }
    
    // Get progress info
    const progress = await db.get(`
      SELECT 
        COUNT(DISTINCT q.id) as total_questions,
        COUNT(DISTINCT a.question_id) as answered_questions
      FROM questions q
      LEFT JOIN answers a ON q.id = a.question_id AND a.session_id = ?
    `, [sessionId]);
    
    res.json({
      success: true,
      question: nextQuestion,
      progress: {
        current: progress.answered_questions + 1,
        total: progress.total_questions,
        percentage: Math.round(((progress.answered_questions + 1) / progress.total_questions) * 100)
      }
    });
    
  } catch (error) {
    req.app.locals.logger.error('Get next question error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get unanswered questions for a session
router.get('/session/:sessionId/unanswered', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const unansweredQuestions = await db.all(`
      SELECT 
        q.question_key,
        q.question_text,
        q.category,
        p.name as pillar_name,
        p.description as pillar_description,
        q.priority
      FROM questions q
      JOIN pillars p ON q.pillar_id = p.id
      LEFT JOIN answers a ON q.id = a.question_id AND a.session_id = ?
      WHERE a.id IS NULL
      ORDER BY q.priority DESC, p.name, q.category
    `, [sessionId]);
    
    res.json({
      success: true,
      questions: unansweredQuestions
    });
  } catch (error) {
    req.app.locals.logger.error('Get unanswered questions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get analysis progress for a session
router.get('/session/:sessionId/progress', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const progress = await db.all(`
      SELECT 
        p.name as pillar_name,
        COUNT(q.id) as total_questions,
        COUNT(a.id) as answered_questions,
        ROUND(COUNT(a.id) * 100.0 / COUNT(q.id), 2) as completion_percentage
      FROM pillars p
      JOIN questions q ON p.id = q.pillar_id
      LEFT JOIN answers a ON q.id = a.question_id AND a.session_id = ?
      GROUP BY p.id, p.name
      ORDER BY p.name
    `, [sessionId]);
    
    const totalQuestions = progress.reduce((sum, pillar) => sum + pillar.total_questions, 0);
    const totalAnswered = progress.reduce((sum, pillar) => sum + pillar.answered_questions, 0);
    const overallProgress = totalQuestions > 0 ? Math.round((totalAnswered / totalQuestions) * 100) : 0;
    
    res.json({
      success: true,
      progress: {
        overall: overallProgress,
        byPillar: progress,
        totalQuestions,
        totalAnswered
      }
    });
  } catch (error) {
    req.app.locals.logger.error('Get progress error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk answer submission
router.post('/bulk-answer', async (req, res) => {
  try {
    const { sessionId, answers } = req.body;

    if (!sessionId || !Array.isArray(answers)) {
      return res.status(400).json({ 
        error: 'Session ID and answers array are required' 
      });
    }

    const results = [];
    
    for (const answerData of answers) {
      const { questionKey, answer, confidence, source = 'user' } = answerData;
      
      if (!questionKey || !answer) {
        results.push({ questionKey, success: false, error: 'Missing question key or answer' });
        continue;
      }

      try {
        // Get question ID
        const question = await db.get(
          'SELECT id FROM questions WHERE question_key = ?',
          [questionKey]
        );

        if (!question) {
          results.push({ questionKey, success: false, error: 'Question not found' });
          continue;
        }

        // Insert or update answer
        await db.run(
          `INSERT INTO answers (question_id, session_id, answer_text, confidence_score, source, updated_at) 
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(question_id, session_id) DO UPDATE SET 
           answer_text = excluded.answer_text,
           confidence_score = excluded.confidence_score,
           source = excluded.source,
           updated_at = CURRENT_TIMESTAMP`,
          [question.id, sessionId, answer, confidence || 0.8, source]
        );

        results.push({ questionKey, success: true });
      } catch (error) {
        results.push({ questionKey, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    res.json({
      success: true,
      message: `Processed ${results.length} answers: ${successCount} successful, ${failureCount} failed`,
      results
    });

  } catch (error) {
    req.app.locals.logger.error('Bulk answer error:', error);
    res.status(500).json({ error: error.message });
  }
});

export { router as questionsRoutes }; 