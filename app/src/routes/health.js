import { Router } from 'express';

const router = Router();

// General health check
router.get('/', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      services: {
        database: 'unknown',
        aws: 'unknown',
        bedrock: 'unknown'
      }
    };

    // Check database
    try {
      const db = req.app.locals.db || (await import('../database/init.js')).db;
      await db.get('SELECT 1');
      health.services.database = 'healthy';
    } catch (error) {
      health.services.database = 'unhealthy';
      health.status = 'degraded';
    }

    // Check AWS connection
    try {
      const awsService = req.app.locals.awsService();
      const awsHealth = await awsService.testConnection();
      health.services.aws = awsHealth.success ? 'healthy' : 'unhealthy';
      if (!awsHealth.success) {
        health.status = 'degraded';
      }
    } catch (error) {
      health.services.aws = 'unhealthy';
      health.status = 'degraded';
    }

    // Check Bedrock connection
    try {
      const bedrockService = req.app.locals.bedrockService();
      const bedrockHealth = await bedrockService.testConnection();
      health.services.bedrock = bedrockHealth.success ? 'healthy' : 'unhealthy';
      if (!bedrockHealth.success) {
        health.status = 'degraded';
      }
    } catch (error) {
      health.services.bedrock = 'unhealthy';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    req.app.locals.logger.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// AWS service health check
router.get('/aws', async (req, res) => {
  try {
    const awsService = req.app.locals.awsService();
    const health = await awsService.testConnection();
    
    const response = {
      service: 'AWS',
      status: health.success ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      message: health.message || health.error,
      region: awsService.region
    };

    const statusCode = health.success ? 200 : 503;
    res.status(statusCode).json(response);

  } catch (error) {
    req.app.locals.logger.error('AWS health check error:', error);
    res.status(500).json({
      service: 'AWS',
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Bedrock service health check
router.get('/bedrock', async (req, res) => {
  try {
    const bedrockService = req.app.locals.bedrockService();
    const health = await bedrockService.testConnection();
    
    const response = {
      service: 'Bedrock',
      status: health.success ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      message: health.message || health.error,
      modelId: bedrockService.modelId
    };

    const statusCode = health.success ? 200 : 503;
    res.status(statusCode).json(response);

  } catch (error) {
    req.app.locals.logger.error('Bedrock health check error:', error);
    res.status(500).json({
      service: 'Bedrock',
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Database health check
router.get('/database', async (req, res) => {
  try {
    const db = req.app.locals.db || (await import('../database/init.js')).db;
    
    // Test basic connectivity
    await db.get('SELECT 1');
    
    // Get some basic stats
    const stats = await Promise.all([
      db.get('SELECT COUNT(*) as count FROM pillars'),
      db.get('SELECT COUNT(*) as count FROM questions'),
      db.get('SELECT COUNT(*) as count FROM analysis_sessions'),
      db.get('SELECT COUNT(*) as count FROM answers')
    ]);

    const response = {
      service: 'Database',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      message: 'Database connection successful',
      stats: {
        pillars: stats[0].count,
        questions: stats[1].count,
        sessions: stats[2].count,
        answers: stats[3].count
      }
    };

    res.json(response);

  } catch (error) {
    req.app.locals.logger.error('Database health check error:', error);
    res.status(500).json({
      service: 'Database',
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// System info
router.get('/system', (req, res) => {
  const response = {
    timestamp: new Date().toISOString(),
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      },
      cpu: process.cpuUsage()
    },
    environment: {
      region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
      port: process.env.PORT || 8080,
      nodeEnv: process.env.NODE_ENV || 'development'
    }
  };

  res.json(response);
});

export { router as healthRoutes }; 