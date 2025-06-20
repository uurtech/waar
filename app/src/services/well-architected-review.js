import db from '../database/init.js';

export class WellArchitectedReviewService {
  constructor(awsService, bedrockService) {
    this.awsService = awsService;
    this.bedrockService = bedrockService;
  }

  async updateProgress(sessionId, step, message, percentage = null) {
    try {
      const progressData = {
        currentStep: step,
        message: message,
        percentage: percentage,
        timestamp: new Date().toISOString(),
        steps: [
          { id: 'initializing', name: 'Initializing Review', completed: step >= 1 },
          { id: 'aws_analysis', name: 'Analyzing AWS Environment', completed: step >= 2 },
          { id: 'ai_analysis', name: 'AI Analysis with Bedrock', completed: step >= 3 },
          { id: 'storing_results', name: 'Storing Analysis Results', completed: step >= 4 },
          { id: 'preparing_questions', name: 'Preparing Questions', completed: step >= 5 },
          { id: 'complete', name: 'Review Ready', completed: step >= 6 }
        ]
      };

      await db.run(
        'UPDATE analysis_sessions SET progress_data = ? WHERE id = ?',
        [JSON.stringify(progressData), sessionId]
      );
      
      console.log(`Progress Update [${sessionId}]: Step ${step} - ${message}`);
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  }

  async startReview(sessionId) {
    try {
      console.log(`🚀 Starting Well-Architected Review for session ${sessionId}`);

      // Initialize progress tracking
      await this.updateProgress(sessionId, 1, 'Initializing Well-Architected Review...', 10);

      // Step 1: Perform comprehensive AWS analysis
      await this.updateProgress(sessionId, 2, 'Analyzing AWS environment (Cost, IAM, Compute, Security)...', 30);
      const awsAnalysis = await this.awsService.performComprehensiveAnalysis();
      
      if (!awsAnalysis.success) {
        throw new Error(`AWS analysis failed: ${awsAnalysis.error}`);
      }

      // Step 2: Let Bedrock Agent analyze AWS data and answer questions automatically
      await this.updateProgress(sessionId, 3, 'AI analyzing AWS data with Bedrock Agent...', 60);
      const agentAnalysis = await this.bedrockService.analyzeAWSDataForWellArchitected(awsAnalysis.data);

      // Step 3: Store initial analysis and auto-answered questions
      await this.updateProgress(sessionId, 4, 'Storing analysis results and auto-answered questions...', 80);
      await this.storeInitialAnalysis(sessionId, awsAnalysis.data, agentAnalysis);

      // Step 4: Identify questions that need user input
      await this.updateProgress(sessionId, 5, 'Preparing interactive questions...', 90);
      const unansweredQuestions = await this.getUnansweredQuestions(sessionId);

      // Step 5: Complete initialization
      await this.updateProgress(sessionId, 6, 'Review ready! Starting interactive questions...', 100);

      // Update session status to completed and store results
      await db.run(
        'UPDATE analysis_sessions SET analysis_status = ?, bedrock_analysis = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['completed', JSON.stringify({ 
          awsData: awsAnalysis.data, 
          agentAnalysis,
          autoAnsweredQuestions: agentAnalysis.autoAnsweredQuestions || 0,
          totalQuestions: await this.getTotalQuestions(),
          unansweredQuestions: unansweredQuestions.length,
          nextQuestion: unansweredQuestions.length > 0 ? unansweredQuestions[0] : null
        }), sessionId]
      );

      console.log(`✅ Review started. ${agentAnalysis.autoAnsweredQuestions || 0} questions auto-answered, ${unansweredQuestions.length} need user input`);

      return {
        success: true,
        sessionId,
        awsAnalysis: awsAnalysis.data,
        agentAnalysis,
        nextQuestion: unansweredQuestions.length > 0 ? unansweredQuestions[0] : null,
        totalQuestions: await this.getTotalQuestions(),
        answeredQuestions: agentAnalysis.autoAnsweredQuestions || 0,
        remainingQuestions: unansweredQuestions.length
      };

    } catch (error) {
      console.error('❌ Failed to start Well-Architected Review:', error);
      throw error;
    }
  }

  async storeInitialAnalysis(sessionId, awsData, agentAnalysis) {
    // Store AWS analysis data
    await db.run(
      'INSERT OR REPLACE INTO analysis_sessions (id, analysis_status, bedrock_analysis, progress_data, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [sessionId, 'in_progress', JSON.stringify({ awsData, agentAnalysis }), null]
    );

    // Store auto-answered questions
    if (agentAnalysis.autoAnswers) {
      for (const answer of agentAnalysis.autoAnswers) {
        const question = await db.get(
          'SELECT id FROM questions WHERE question_key = ?',
          [answer.questionKey]
        );

        if (question) {
          await db.run(
            `INSERT OR REPLACE INTO answers (question_id, session_id, answer_text, confidence_score, source, created_at) 
             VALUES (?, ?, ?, ?, 'agent', CURRENT_TIMESTAMP)`,
            [question.id, sessionId, answer.answer, answer.confidence]
          );
        }
      }
    }
  }

  async getUnansweredQuestions(sessionId) {
    const unansweredQuestions = await db.all(`
      SELECT q.id, q.question_key, q.question_text, q.category, p.name as pillar_name
      FROM questions q
      JOIN pillars p ON q.pillar_id = p.id
      LEFT JOIN answers a ON q.id = a.question_id AND a.session_id = ?
      WHERE a.id IS NULL
      ORDER BY q.priority DESC, q.id ASC
    `, [sessionId]);

    return unansweredQuestions;
  }

  async getTotalQuestions() {
    const result = await db.get('SELECT COUNT(*) as count FROM questions');
    return result.count;
  }

  async submitUserAnswer(sessionId, questionKey, userAnswer) {
    try {
      console.log(`📝 Processing user answer for question ${questionKey}`);

      // Get the question
      const question = await db.get(
        'SELECT * FROM questions WHERE question_key = ?',
        [questionKey]
      );

      if (!question) {
        throw new Error(`Question ${questionKey} not found`);
      }

      // Let the agent analyze the user's answer and potentially map it to multiple questions
      const agentAnalysis = await this.bedrockService.analyzeUserAnswer(userAnswer, questionKey, sessionId);

      // Store the primary answer
      await db.run(
        `INSERT OR REPLACE INTO answers (question_id, session_id, answer_text, confidence_score, source, created_at) 
         VALUES (?, ?, ?, ?, 'user', CURRENT_TIMESTAMP)`,
        [question.id, sessionId, userAnswer, 0.9]
      );

      // Store any additional answers the agent derived
      if (agentAnalysis.additionalAnswers) {
        for (const additionalAnswer of agentAnalysis.additionalAnswers) {
          const relatedQuestion = await db.get(
            'SELECT id FROM questions WHERE question_key = ?',
            [additionalAnswer.questionKey]
          );

          if (relatedQuestion) {
            await db.run(
              `INSERT OR REPLACE INTO answers (question_id, session_id, answer_text, confidence_score, source, created_at) 
               VALUES (?, ?, ?, ?, 'agent_derived', CURRENT_TIMESTAMP)`,
              [relatedQuestion.id, sessionId, additionalAnswer.answer, additionalAnswer.confidence]
            );
          }
        }
      }

      // Get next unanswered question
      const unansweredQuestions = await this.getUnansweredQuestions(sessionId);
      const nextQuestion = unansweredQuestions.length > 0 ? unansweredQuestions[0] : null;

      // If all questions are answered, generate final report
      if (!nextQuestion) {
        await this.generateFinalReport(sessionId);
      }

      console.log(`✅ Answer processed. ${agentAnalysis.additionalAnswers?.length || 0} additional questions answered automatically`);

      return {
        success: true,
        additionalAnswersCount: agentAnalysis.additionalAnswers?.length || 0,
        nextQuestion,
        totalQuestions: await this.getTotalQuestions(),
        answeredQuestions: (await this.getTotalQuestions()) - unansweredQuestions.length,
        isComplete: !nextQuestion
      };

    } catch (error) {
      console.error('❌ Failed to process user answer:', error);
      throw error;
    }
  }

  async generateFinalReport(sessionId) {
    try {
      console.log(`📊 Generating final Well-Architected report for session ${sessionId}`);

      // Get all answers for this session
      const answers = await db.all(`
        SELECT q.question_key, q.question_text, q.category, p.name as pillar_name, 
               a.answer_text, a.confidence_score, a.source
        FROM answers a
        JOIN questions q ON a.question_id = q.id
        JOIN pillars p ON q.pillar_id = p.id
        WHERE a.session_id = ?
        ORDER BY p.name, q.category, q.id
      `, [sessionId]);

      // Get AWS analysis data
      const session = await db.get(
        'SELECT bedrock_analysis FROM analysis_sessions WHERE id = ?',
        [sessionId]
      );

      const sessionData = JSON.parse(session.bedrock_analysis || '{}');

      // Generate comprehensive report using Bedrock Agent
      const finalReport = await this.bedrockService.generateWellArchitectedReport(answers, sessionData.awsData);

      // Update session with final report
      await db.run(
        'UPDATE analysis_sessions SET analysis_status = ?, recommendations = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['completed', JSON.stringify(finalReport), sessionId]
      );

      console.log('✅ Final Well-Architected report generated');

      return finalReport;

    } catch (error) {
      console.error('❌ Failed to generate final report:', error);
      throw error;
    }
  }

  async getReviewStatus(sessionId) {
    try {
      const session = await db.get(
        'SELECT * FROM analysis_sessions WHERE id = ?',
        [sessionId]
      );

      if (!session) {
        throw new Error('Session not found');
      }

      const totalQuestions = await this.getTotalQuestions();
      const answeredQuestions = await db.get(`
        SELECT COUNT(*) as count 
        FROM answers a
        JOIN questions q ON a.question_id = q.id
        WHERE a.session_id = ?
      `, [sessionId]);

      const unansweredQuestions = await this.getUnansweredQuestions(sessionId);

      return {
        sessionId,
        status: session.analysis_status,
        totalQuestions,
        answeredQuestions: answeredQuestions.count,
        remainingQuestions: unansweredQuestions.length,
        nextQuestion: unansweredQuestions.length > 0 ? unansweredQuestions[0] : null,
        isComplete: session.analysis_status === 'completed',
        progress: Math.round((answeredQuestions.count / totalQuestions) * 100)
      };

    } catch (error) {
      console.error('❌ Failed to get review status:', error);
      throw error;
    }
  }

  async getFinalReport(sessionId) {
    try {
      const session = await db.get(
        'SELECT recommendations, bedrock_analysis FROM analysis_sessions WHERE id = ? AND analysis_status = "completed"',
        [sessionId]
      );

      if (!session) {
        throw new Error('Completed session not found');
      }

      const answers = await db.all(`
        SELECT q.question_key, q.question_text, q.category, p.name as pillar_name, 
               a.answer_text, a.confidence_score, a.source
        FROM answers a
        JOIN questions q ON a.question_id = q.id
        JOIN pillars p ON q.pillar_id = p.id
        WHERE a.session_id = ?
        ORDER BY p.name, q.category, q.id
      `, [sessionId]);

      return {
        sessionId,
        report: JSON.parse(session.recommendations || '{}'),
        answers,
        awsAnalysis: JSON.parse(session.bedrock_analysis || '{}').awsData
      };

    } catch (error) {
      console.error('❌ Failed to get final report:', error);
      throw error;
    }
  }
} 