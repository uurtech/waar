import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import winston from 'winston';

// Import configuration manager
import configManager from './src/config/index.js';

// Import custom modules
import { initializeDatabase } from './src/database/init.js';
import { setupRoutes } from './src/routes/index.js';
import { AWSService } from './src/services/aws.js';
import { BedrockService } from './src/services/bedrock.js';

// Import routes
import { indexRoutes } from './src/routes/index.js';
import { analysisRoutes } from './src/routes/analysis.js';
import { questionsRoutes } from './src/routes/questions.js';
import { mcpRoutes } from './src/routes/mcp.js';
import { healthRoutes } from './src/routes/health.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WellArchitectedServer {
  constructor() {
    this.app = express();
    this.config = null;
    this.logger = null;
    this.awsService = null;
    this.bedrockService = null;
  }

  async initialize() {
    try {
      // Load configuration first
      console.log('🚀 Loading configuration...');
      this.config = await configManager.loadConfig();
      configManager.validateConfig();
      configManager.logConfiguration();

      // Initialize logger
      this.initializeLogger();

      // Initialize services
      await this.initializeServices();

      // Setup middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      console.log('✅ Server initialization completed successfully');
      return true;

    } catch (error) {
      console.error('❌ Server initialization failed:', error);
      throw error;
    }
  }

  initializeLogger() {
    const appConfig = this.config.application;
    
    this.logger = winston.createLogger({
      level: appConfig.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} [${level}]: ${message}${stack ? '\n' + stack : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ 
          filename: '/var/app/logs/error.log', 
          level: 'error' 
        }),
        new winston.transports.File({ 
          filename: '/var/app/logs/combined.log' 
        })
      ]
    });

    // Make logger available globally
    this.app.locals.logger = this.logger;
    console.log(`📝 Logger initialized with level: ${appConfig.logLevel}`);
  }

  async initializeServices() {
    try {
      const awsConfig = this.config.aws;
      const bedrockConfig = this.config.bedrock;

      // Initialize AWS Service
      this.awsService = new AWSService();
      await this.awsService.initialize(awsConfig);

      // Initialize Bedrock Service
      this.bedrockService = new BedrockService(this.awsService);
      
      // Configure for agent-only mode if specified
      if (bedrockConfig.agentOnly && !bedrockConfig.agentId) {
        throw new Error('Agent-only mode is enabled but no Agent ID is provided');
      }

      await this.bedrockService.initialize();

      // Make services available to routes
      this.app.locals.awsService = () => this.awsService;
      this.app.locals.bedrockService = () => this.bedrockService;
      this.app.locals.config = this.config;

      this.logger.info('✅ All services initialized successfully');

      // Log service status
      console.log('\n🔧 Service Status:');
      console.log('==================');
      console.log(`AWS Service: ${this.awsService ? '✅ Ready' : '❌ Failed'}`);
      console.log(`Bedrock Service: ${this.bedrockService ? '✅ Ready' : '❌ Failed'}`);
      console.log(`Agent Mode: ${bedrockConfig.agentOnly ? '✅ Enabled' : '❌ Disabled'}`);
      console.log(`Agent ID: ${bedrockConfig.agentId || 'Not Set'}`);
      console.log('==================\n');

    } catch (error) {
      this.logger.error('Failed to initialize services:', error);
      throw error;
    }
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"]
        }
      }
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' ? false : true,
      credentials: true
    }));

    // Compression and parsing
    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Static files
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Request logging
    this.app.use((req, res, next) => {
      this.logger.info(`${req.method} ${req.url} - ${req.ip}`);
      next();
    });

    this.logger.info('✅ Middleware configured');
  }

  setupRoutes() {
    // Mount routes
    this.app.use('/', indexRoutes);
    this.app.use('/api/analysis', analysisRoutes);
    this.app.use('/api/questions', questionsRoutes);
    this.app.use('/api/mcp', mcpRoutes);
    this.app.use('/api/health', healthRoutes);

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found',
        path: req.originalUrl
      });
    });

    this.logger.info('✅ Routes configured');
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use((error, req, res, next) => {
      this.logger.error('Unhandled error:', error);

      // Don't expose internal errors in production
      const isDevelopment = this.config.application.nodeEnv !== 'production';
      
      res.status(error.status || 500).json({
        error: isDevelopment ? error.message : 'Internal Server Error',
        ...(isDevelopment && { stack: error.stack })
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

    this.logger.info('✅ Error handling configured');
  }

  async start() {
    try {
      await this.initialize();
      
      const port = this.config.application.port;
      
      this.app.listen(port, '0.0.0.0', () => {
        console.log('\n🎉 AWS Well-Architected Reviewer Started!');
        console.log('=========================================');
        console.log(`🌐 Server: http://localhost:${port}`);
        console.log(`🔧 Environment: ${this.config.application.nodeEnv}`);
        console.log(`📊 Health Check: http://localhost:${port}/api/health`);
        console.log(`🤖 Agent Mode: ${this.config.bedrock.agentOnly ? 'ENABLED' : 'DISABLED'}`);
        console.log('=========================================\n');
        
        this.logger.info(`Server started on port ${port}`);
      });

    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  async gracefulShutdown() {
    console.log('\n🔄 Graceful shutdown initiated...');
    
    // Close server
    this.server?.close(() => {
      console.log('✅ Server closed');
    });

    // Close database connections, cleanup resources, etc.
    // Add any cleanup logic here

    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  }
}

// Handle graceful shutdown
const server = new WellArchitectedServer();

process.on('SIGTERM', () => server.gracefulShutdown());
process.on('SIGINT', () => server.gracefulShutdown());

// Start the server
server.start().catch((error) => {
  console.error('❌ Server startup failed:', error);
  process.exit(1);
}); 