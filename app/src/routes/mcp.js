import { Router } from 'express';

const router = Router();

// Get Cost Explorer analysis
router.get('/cost', async (req, res) => {
  try {
    const awsService = req.app.locals.awsService();
    const logger = req.app.locals.logger;
    
    const { startDate, endDate, granularity } = req.query;
    
    logger.info('Starting cost analysis');
    
    const costAnalysis = await awsService.analyzeCosts({
      startDate,
      endDate,
      granularity
    });

    res.json({
      success: true,
      data: costAnalysis.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    req.app.locals.logger.error('Cost analysis error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get IAM security analysis
router.get('/iam', async (req, res) => {
  try {
    const awsService = req.app.locals.awsService();
    const logger = req.app.locals.logger;
    
    logger.info('Starting IAM security analysis');
    
    const iamAnalysis = await awsService.analyzeIAM();

    res.json({
      success: true,
      data: iamAnalysis.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    req.app.locals.logger.error('IAM analysis error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get Compute resources analysis
router.get('/compute', async (req, res) => {
  try {
    const awsService = req.app.locals.awsService();
    const logger = req.app.locals.logger;
    
    logger.info('Starting compute resources analysis');
    
    const computeAnalysis = await awsService.analyzeCompute();

    res.json({
      success: true,
      data: computeAnalysis.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    req.app.locals.logger.error('Compute analysis error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get comprehensive AWS analysis
router.get('/comprehensive', async (req, res) => {
  try {
    const awsService = req.app.locals.awsService();
    const logger = req.app.locals.logger;
    
    logger.info('Starting comprehensive AWS analysis');
    
    const [costAnalysis, iamAnalysis, computeAnalysis] = await Promise.all([
      awsService.analyzeCosts(),
      awsService.analyzeIAM(),
      awsService.analyzeCompute()
    ]);

    // Combine analyses and provide recommendations
    const comprehensiveAnalysis = {
      cost: costAnalysis.data,
      iam: iamAnalysis.data,
      compute: computeAnalysis.data,
      summary: {
        totalRecommendations: 0,
        criticalIssues: 0,
        costSavingsOpportunities: 0,
        securityRisks: 0,
        performanceIssues: 0
      }
    };

    // Calculate summary metrics
    if (costAnalysis.data?.recommendations) {
      comprehensiveAnalysis.summary.costSavingsOpportunities = costAnalysis.data.recommendations.length;
      comprehensiveAnalysis.summary.totalRecommendations += costAnalysis.data.recommendations.length;
    }

    if (iamAnalysis.data?.analysis?.findings) {
      const criticalFindings = iamAnalysis.data.analysis.findings.filter(f => 
        f.type === 'OVERPRIVILEGED_ROLE' || f.type === 'UNUSED_USER'
      );
      comprehensiveAnalysis.summary.securityRisks = criticalFindings.length;
      comprehensiveAnalysis.summary.totalRecommendations += criticalFindings.length;
    }

    if (computeAnalysis.data?.analysis?.findings) {
      comprehensiveAnalysis.summary.performanceIssues = computeAnalysis.data.analysis.findings.length;
      comprehensiveAnalysis.summary.totalRecommendations += computeAnalysis.data.analysis.findings.length;
    }

    res.json({
      success: true,
      data: comprehensiveAnalysis,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    req.app.locals.logger.error('Comprehensive analysis error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get MCP analysis for specific session
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const db = req.app.locals.db;
    
    const mcpAnalysis = await db.all(
      'SELECT analysis_type, results, created_at FROM mcp_analysis WHERE session_id = ? ORDER BY created_at DESC',
      [sessionId]
    );

    const analysisData = mcpAnalysis.reduce((acc, item) => {
      acc[item.analysis_type] = {
        data: JSON.parse(item.results),
        timestamp: item.created_at
      };
      return acc;
    }, {});

    res.json({
      success: true,
      sessionId,
      analysis: analysisData
    });

  } catch (error) {
    req.app.locals.logger.error('Get session MCP analysis error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Refresh MCP analysis for session
router.post('/session/:sessionId/refresh', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { analysisTypes } = req.body; // ['cost', 'iam', 'compute'] or leave empty for all
    
    const awsService = req.app.locals.awsService();
    const db = req.app.locals.db;
    const logger = req.app.locals.logger;
    
    logger.info(`Refreshing MCP analysis for session ${sessionId}`);
    
    const typesToRefresh = analysisTypes || ['cost', 'iam', 'compute'];
    const refreshPromises = [];
    
    if (typesToRefresh.includes('cost')) {
      refreshPromises.push(
        awsService.analyzeCosts().then(result => ({ type: 'cost', result }))
      );
    }
    
    if (typesToRefresh.includes('iam')) {
      refreshPromises.push(
        awsService.analyzeIAM().then(result => ({ type: 'iam', result }))
      );
    }
    
    if (typesToRefresh.includes('compute')) {
      refreshPromises.push(
        awsService.analyzeCompute().then(result => ({ type: 'compute', result }))
      );
    }
    
    const results = await Promise.all(refreshPromises);
    
    // Update database with new results
    for (const { type, result } of results) {
      await db.run(
        'INSERT INTO mcp_analysis (session_id, analysis_type, results) VALUES (?, ?, ?)',
        [sessionId, type, JSON.stringify(result)]
      );
    }
    
    res.json({
      success: true,
      message: `Refreshed ${results.length} analysis types`,
      refreshed: results.map(r => r.type),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    req.app.locals.logger.error('Refresh MCP analysis error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get cost trends
router.get('/cost/trends', async (req, res) => {
  try {
    const awsService = req.app.locals.awsService();
    const { days = 30 } = req.query;
    
    const trends = await awsService.analyzeCosts({
      startDate: awsService.getDateDaysAgo(parseInt(days)),
      endDate: awsService.getDateDaysAgo(1),
      granularity: 'DAILY'
    });

    res.json({
      success: true,
      data: trends.data,
      period: `${days} days`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    req.app.locals.logger.error('Cost trends error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get security recommendations
router.get('/iam/recommendations', async (req, res) => {
  try {
    const awsService = req.app.locals.awsService();
    const iamAnalysis = await awsService.analyzeIAM();
    
    const recommendations = [];
    
    if (iamAnalysis.data?.analysis?.findings) {
      iamAnalysis.data.analysis.findings.forEach(finding => {
        switch (finding.type) {
          case 'UNUSED_USER':
            recommendations.push({
              priority: 'Medium',
              title: 'Remove Unused User',
              description: finding.description,
              resource: finding.resource,
              action: 'Consider removing or disabling this user account',
              pillar: 'Security'
            });
            break;
          case 'OVERPRIVILEGED_ROLE':
            recommendations.push({
              priority: 'High',
              title: 'Restrict Role Permissions',
              description: finding.description,
              resource: finding.resource,
              action: 'Review and restrict the assume role policy',
              pillar: 'Security'
            });
            break;
          default:
            recommendations.push({
              priority: 'Low',
              title: 'Review Security Finding',
              description: finding.description,
              resource: finding.resource,
              action: 'Manual review required',
              pillar: 'Security'
            });
        }
      });
    }

    res.json({
      success: true,
      recommendations,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    req.app.locals.logger.error('Security recommendations error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

export { router as mcpRoutes }; 