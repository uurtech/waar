import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import db from '../database/init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Analyze Infrastructure as Code templates
router.post('/analyze-iac', async (req, res) => {
  try {
    const { sourcePath } = req.body;
    const sessionId = uuidv4();
    const bedrockService = req.app.locals.bedrockService();
    const awsService = req.app.locals.awsService();
    const logger = req.app.locals.logger;

    logger.info(`Starting IaC analysis for session ${sessionId}`);

    // Create analysis session
    await db.run(
      'INSERT INTO analysis_sessions (id, codebase_path, analysis_status) VALUES (?, ?, ?)',
      [sessionId, sourcePath || '/var/app/iac_templates', 'processing']
    );

    // Step 1: Initialize IaC analysis
    await updateProgress(sessionId, 1, 'Initializing Infrastructure as Code analysis...', 10);

    // Analyze the IaC templates
    const iacPath = sourcePath || '/var/app/iac_templates';
    
    // Check if IaC templates exist
    try {
      await fs.access(iacPath);
    } catch (error) {
      throw new Error(`IaC templates path not found: ${iacPath}. Please ensure you've mapped your CloudFormation/Terraform templates volume correctly.`);
    }

    // Create temp folder for this analysis session
    const tempAnalysisPath = await createTempAnalysisFolder(sessionId, iacPath);
    
    // Analyze IaC structure (this will now capture template contents)
    const iacStructure = await analyzeCodebaseStructure(tempAnalysisPath);

    // Validate that we found IaC templates
    if (!iacStructure.iacTemplates || iacStructure.iacTemplates.length === 0) {
      throw new Error('No Infrastructure as Code templates found. Please ensure your volume contains CloudFormation (.yaml, .yml, .json) or Terraform (.tf) files.');
    }

    logger.info(`Found ${iacStructure.iacTemplates.length} IaC templates: ${iacStructure.iacTemplates.map(t => `${t.fileName} (${t.type})`).join(', ')}`);

    // Get AWS analysis data (current state for comparison)
    const [costAnalysis, iamAnalysis, computeAnalysis] = await Promise.all([
      awsService.analyzeCosts(),
      awsService.analyzeIAM(),
      awsService.analyzeCompute()
    ]);

    // Analyze with Bedrock Agent (will use IaC-specific prompts)
    const analysisResult = await bedrockService.analyzeCodebase(iacStructure, {
      costAnalysis: costAnalysis.data,
      iamAnalysis: iamAnalysis.data,
      computeAnalysis: computeAnalysis.data
    });

    // Update session with results
    await db.run(
      'UPDATE analysis_sessions SET analysis_status = ?, bedrock_analysis = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['completed', JSON.stringify(analysisResult), sessionId]
    );

    // Store MCP analysis results
    await Promise.all([
      db.run('INSERT INTO mcp_analysis (session_id, analysis_type, results) VALUES (?, ?, ?)', 
        [sessionId, 'cost', JSON.stringify(costAnalysis)]),
      db.run('INSERT INTO mcp_analysis (session_id, analysis_type, results) VALUES (?, ?, ?)', 
        [sessionId, 'iam', JSON.stringify(iamAnalysis)]),
      db.run('INSERT INTO mcp_analysis (session_id, analysis_type, results) VALUES (?, ?, ?)', 
        [sessionId, 'compute', JSON.stringify(computeAnalysis)])
    ]);

    logger.info(`IaC analysis completed for session ${sessionId}`);

    res.json({
      success: true,
      sessionId,
      analysis: analysisResult.analysis,
      message: `Successfully analyzed ${iacStructure.iacTemplates.length} Infrastructure as Code templates`,
      source: analysisResult.source || 'agent',
      templatesAnalyzed: iacStructure.iacTemplates.map(t => ({
        path: t.path,
        type: t.type,
        fileName: t.fileName,
        size: t.size
      })),
      tempPath: tempAnalysisPath
    });

  } catch (error) {
    req.app.locals.logger.error('IaC analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Analyze mapped source code (no upload needed) - Legacy endpoint
router.post('/analyze', async (req, res) => {
  try {
    const { sourcePath } = req.body;
    const sessionId = uuidv4();
    const bedrockService = req.app.locals.bedrockService();
    const awsService = req.app.locals.awsService();
    const logger = req.app.locals.logger;

    logger.info(`Starting analysis for session ${sessionId}`);

    // Create analysis session
    await db.run(
      'INSERT INTO analysis_sessions (id, codebase_path, analysis_status) VALUES (?, ?, ?)',
      [sessionId, sourcePath || '/var/app/mapped_source', 'processing']
    );

    // Step 1: Initialize
    await updateProgress(sessionId, 1, 'Initializing analysis session...', 10);

    // Analyze the mapped source code
    const mappedSourcePath = sourcePath || '/var/app/mapped_source';
    
    // Check if mapped source exists
    try {
      await fs.access(mappedSourcePath);
    } catch (error) {
      throw new Error(`Source code path not found: ${mappedSourcePath}. Please ensure you've mapped your source code volume correctly.`);
    }

    // Step 2: Create temp folder and scan codebase
    await updateProgress(sessionId, 2, 'Creating temporary analysis workspace...', 20);
    const tempAnalysisPath = await createTempAnalysisFolder(sessionId, mappedSourcePath);
    
    await updateProgress(sessionId, 2, 'Scanning codebase structure and technologies...', 30);
    const codebaseStructure = await analyzeCodebaseStructure(tempAnalysisPath);

    // Step 3: AWS analysis
    await updateProgress(sessionId, 3, 'Analyzing AWS resources (Cost, IAM, Compute)...', 50);
    const [costAnalysis, iamAnalysis, computeAnalysis] = await Promise.all([
      awsService.analyzeCosts(),
      awsService.analyzeIAM(),
      awsService.analyzeCompute()
    ]);

    // Step 4: Bedrock AI analysis
    await updateProgress(sessionId, 4, 'Running AI analysis with AWS Bedrock...', 70);
    const analysisResult = await bedrockService.analyzeCodebase(codebaseStructure, {
      costAnalysis: costAnalysis.data,
      iamAnalysis: iamAnalysis.data,
      computeAnalysis: computeAnalysis.data
    });

    // Step 5: Generate report and save results
    await updateProgress(sessionId, 5, 'Generating comprehensive report...', 90);
    
    // Update session with results
    await db.run(
      'UPDATE analysis_sessions SET analysis_status = ?, bedrock_analysis = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['completed', JSON.stringify(analysisResult), sessionId]
    );

    // Store MCP analysis results
    await Promise.all([
      db.run('INSERT INTO mcp_analysis (session_id, analysis_type, results) VALUES (?, ?, ?)', 
        [sessionId, 'cost', JSON.stringify(costAnalysis)]),
      db.run('INSERT INTO mcp_analysis (session_id, analysis_type, results) VALUES (?, ?, ?)', 
        [sessionId, 'iam', JSON.stringify(iamAnalysis)]),
      db.run('INSERT INTO mcp_analysis (session_id, analysis_type, results) VALUES (?, ?, ?)', 
        [sessionId, 'compute', JSON.stringify(computeAnalysis)])
    ]);

    // Step 6: Complete
    await updateProgress(sessionId, 6, 'Analysis completed successfully!', 100);

    logger.info(`Analysis completed for session ${sessionId}`);

    res.json({
      success: true,
      sessionId,
      analysis: analysisResult.analysis,
      message: 'Codebase analyzed successfully',
      source: analysisResult.source || 'model',
      tempPath: tempAnalysisPath
    });

  } catch (error) {
    req.app.locals.logger.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Legacy upload endpoint (kept for backward compatibility)
router.post('/upload', async (req, res) => {
  res.status(400).json({ 
    error: 'File upload is deprecated. Please use the /analyze endpoint with mapped source code volumes.',
    suggestion: 'Map your source code as a volume and use POST /api/analysis/analyze'
  });
});

// Get analysis results
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await db.get(
      'SELECT * FROM analysis_sessions WHERE id = ?',
      [sessionId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Analysis session not found' });
    }

    const mcpAnalysis = await db.all(
      'SELECT analysis_type, results FROM mcp_analysis WHERE session_id = ?',
      [sessionId]
    );

    const answers = await db.all(
      'SELECT q.question_key, q.question_text, a.answer_text, a.confidence_score FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.session_id = ?',
      [sessionId]
    );

    res.json({
      success: true,
      session: {
        ...session,
        bedrock_analysis: JSON.parse(session.bedrock_analysis || '{}')
      },
      mcpAnalysis: mcpAnalysis.reduce((acc, item) => {
        acc[item.analysis_type] = JSON.parse(item.results);
        return acc;
      }, {}),
      answers
    });

  } catch (error) {
    req.app.locals.logger.error('Get analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit answer to question
router.post('/:sessionId/answer', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { questionKey, answer, confidence } = req.body;

    if (!questionKey || !answer) {
      return res.status(400).json({ error: 'Question key and answer are required' });
    }

    // Get question ID
    const question = await db.get(
      'SELECT id FROM questions WHERE question_key = ?',
      [questionKey]
    );

    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Insert or update answer
    await db.run(
      `INSERT INTO answers (question_id, session_id, answer_text, confidence_score, source, updated_at) 
       VALUES (?, ?, ?, ?, 'user', CURRENT_TIMESTAMP)
       ON CONFLICT(question_id, session_id) DO UPDATE SET 
       answer_text = excluded.answer_text,
       confidence_score = excluded.confidence_score,
       updated_at = CURRENT_TIMESTAMP`,
      [question.id, sessionId, answer, confidence || 0.8]
    );

    res.json({
      success: true,
      message: 'Answer saved successfully'
    });

  } catch (error) {
    req.app.locals.logger.error('Save answer error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get follow-up questions
router.post('/:sessionId/follow-up', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const bedrockService = req.app.locals.bedrockService();

    const session = await db.get(
      'SELECT bedrock_analysis FROM analysis_sessions WHERE id = ?',
      [sessionId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Analysis session not found' });
    }

    const answers = await db.all(
      'SELECT q.question_key, a.answer_text FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.session_id = ?',
      [sessionId]
    );

    const userAnswers = answers.reduce((acc, item) => {
      acc[item.question_key] = item.answer_text;
      return acc;
    }, {});

    const analysisResult = JSON.parse(session.bedrock_analysis || '{}');
    const followUpQuestions = await bedrockService.generateFollowUpQuestions(analysisResult, userAnswers);

    res.json({
      success: true,
      questions: followUpQuestions.questions || []
    });

  } catch (error) {
    req.app.locals.logger.error('Follow-up questions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clean up temp analysis folders
router.delete('/:sessionId/cleanup', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const tempPath = path.join('/var/app/temp', `analysis_${sessionId}`);
    
    try {
      await fs.rm(tempPath, { recursive: true, force: true });
      req.app.locals.logger.info(`Cleaned up temp folder: ${tempPath}`);
    } catch (error) {
      req.app.locals.logger.warn(`Failed to cleanup temp folder: ${error.message}`);
    }

    res.json({
      success: true,
      message: 'Cleanup completed'
    });

  } catch (error) {
    req.app.locals.logger.error('Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add progress tracking endpoint
router.get('/progress/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await db.get(
      'SELECT analysis_status, progress_data FROM analysis_sessions WHERE id = ?',
      [sessionId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Analysis session not found' });
    }

    const progressData = session.progress_data ? JSON.parse(session.progress_data) : null;

    res.json({
      success: true,
      sessionId,
      status: session.analysis_status,
      progress: progressData
    });

  } catch (error) {
    req.app.locals.logger.error('Get progress error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
async function updateProgress(sessionId, step, message, percentage = null) {
  try {
    const progressData = {
      currentStep: step,
      message: message,
      percentage: percentage,
      timestamp: new Date().toISOString(),
      steps: [
        { id: 'initializing', name: 'Initializing Analysis', completed: step >= 1 },
        { id: 'scanning', name: 'Scanning Codebase', completed: step >= 2 },
        { id: 'aws_analysis', name: 'Analyzing AWS Resources', completed: step >= 3 },
        { id: 'bedrock_analysis', name: 'AI Analysis with Bedrock', completed: step >= 4 },
        { id: 'generating_report', name: 'Generating Report', completed: step >= 5 },
        { id: 'complete', name: 'Analysis Complete', completed: step >= 6 }
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

async function createTempAnalysisFolder(sessionId, sourcePath) {
  const tempDir = path.join('/var/app/temp', `analysis_${sessionId}`);
  
  try {
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true });
    
    // Copy source files to temp directory (excluding node_modules and other unwanted files)
    await copySourceFiles(sourcePath, tempDir);
    
    return tempDir;
  } catch (error) {
    throw new Error(`Failed to create temp analysis folder: ${error.message}`);
  }
}

async function copySourceFiles(sourcePath, targetPath, currentPath = '') {
  const items = await fs.readdir(path.join(sourcePath, currentPath), { withFileTypes: true });
  
  const excludePatterns = [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    'coverage',
    '.nyc_output',
    'logs',
    'tmp',
    'temp',
    '.cache',
    '.vscode',
    '.idea',
    '.DS_Store',
    'Thumbs.db'
  ];

  for (const item of items) {
    const itemName = item.name;
    const itemPath = path.join(currentPath, itemName);
    const sourceFull = path.join(sourcePath, itemPath);
    const targetFull = path.join(targetPath, itemPath);

    // Skip excluded patterns
    if (excludePatterns.some(pattern => itemName.includes(pattern))) {
      continue;
    }

    // Skip files larger than 10MB
    if (item.isFile()) {
      try {
        const stats = await fs.stat(sourceFull);
        if (stats.size > 10 * 1024 * 1024) {
          continue;
        }
      } catch (error) {
        continue;
      }
    }

    if (item.isDirectory()) {
      await fs.mkdir(targetFull, { recursive: true });
      await copySourceFiles(sourcePath, targetPath, itemPath);
    } else {
      try {
        await fs.copyFile(sourceFull, targetFull);
      } catch (error) {
        // Skip files that can't be copied
        continue;
      }
    }
  }
}

async function analyzeCodebaseStructure(analysisPath) {
  const structure = {
    files: [],
    directories: [],
    technologies: new Set(),
    totalFiles: 0,
    totalSize: 0,
    packageFiles: [],
    configFiles: [],
    dockerFiles: [],
    infraFiles: [],
    iacTemplates: [] // New: Store actual IaC template contents
  };

  async function scanDirectory(dirPath, relativePath = '') {
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        const itemRelativePath = path.join(relativePath, item.name);

        if (item.isDirectory()) {
          structure.directories.push(itemRelativePath);
          await scanDirectory(fullPath, itemRelativePath);
        } else {
          try {
            const stats = await fs.stat(fullPath);
            const ext = path.extname(item.name).toLowerCase();
            
            structure.files.push({
              path: itemRelativePath,
              size: stats.size,
              extension: ext,
              modified: stats.mtime
            });

            structure.totalFiles++;
            structure.totalSize += stats.size;

            // Analyze file types and technologies
            await analyzeFileType(item.name, ext, itemRelativePath, fullPath, structure);

          } catch (error) {
            // Skip files that can't be accessed
            continue;
          }
        }
      }
    } catch (error) {
      // Skip directories that can't be accessed
      return;
    }
  }

  await scanDirectory(analysisPath);
  structure.technologies = Array.from(structure.technologies);
  
  return structure;
}

async function analyzeFileType(fileName, ext, filePath, fullPath, structure) {
  const lowerFileName = fileName.toLowerCase();
  
  // Package files
  if (['package.json', 'yarn.lock', 'package-lock.json', 'pom.xml', 'build.gradle', 'requirements.txt', 'setup.py', 'pipfile', 'composer.json', 'gemfile'].includes(lowerFileName)) {
    structure.packageFiles.push(filePath);
  }

  // Config files
  if (lowerFileName.includes('config') || ['.env', '.yaml', '.yml', '.toml', '.ini', '.conf'].includes(ext) || ['tsconfig.json', 'webpack.config.js', '.eslintrc', '.prettierrc'].includes(lowerFileName)) {
    structure.configFiles.push(filePath);
  }

  // Docker files
  if (lowerFileName.includes('docker') || ['dockerfile', '.dockerignore', 'docker-compose.yml', 'docker-compose.yaml'].includes(lowerFileName)) {
    structure.dockerFiles.push(filePath);
  }

  // Infrastructure files - Enhanced for IaC analysis
  const isIaCFile = (
    ['.tf', '.tfvars', '.tfstate'].includes(ext) ||
    ['.yaml', '.yml', '.json'].includes(ext) && (
      lowerFileName.includes('cloudformation') ||
      lowerFileName.includes('template') ||
      lowerFileName.includes('stack') ||
      lowerFileName.includes('cfn')
    ) ||
    lowerFileName.includes('terraform') ||
    lowerFileName.includes('serverless') ||
    lowerFileName.includes('sam-template') ||
    lowerFileName.includes('cdk')
  );

  if (isIaCFile) {
    structure.infraFiles.push(filePath);
    
    // Read and store IaC template content for analysis
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const iacTemplate = {
        path: filePath,
        fileName: fileName,
        type: detectIaCType(fileName, ext, content),
        content: content,
        size: content.length
      };
      structure.iacTemplates.push(iacTemplate);
    } catch (error) {
      console.warn(`Could not read IaC file ${filePath}:`, error.message);
    }
  }

  // Detect technologies
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
    structure.technologies.add('JavaScript/TypeScript');
  } else if (['.py'].includes(ext)) {
    structure.technologies.add('Python');
  } else if (['.java'].includes(ext)) {
    structure.technologies.add('Java');
  } else if (['.go'].includes(ext)) {
    structure.technologies.add('Go');
  } else if (['.rs'].includes(ext)) {
    structure.technologies.add('Rust');
  } else if (['.php'].includes(ext)) {
    structure.technologies.add('PHP');
  } else if (['.rb'].includes(ext)) {
    structure.technologies.add('Ruby');
  } else if (['.cs'].includes(ext)) {
    structure.technologies.add('C#');
  } else if (['.cpp', '.cc', '.cxx', '.c'].includes(ext)) {
    structure.technologies.add('C/C++');
  } else if (['.swift'].includes(ext)) {
    structure.technologies.add('Swift');
  } else if (['.kt', '.kts'].includes(ext)) {
    structure.technologies.add('Kotlin');
  } else if (['.scala'].includes(ext)) {
    structure.technologies.add('Scala');
  } else if (['.clj', '.cljs'].includes(ext)) {
    structure.technologies.add('Clojure');
  }

  // Framework detection
  if (lowerFileName === 'package.json') {
    structure.technologies.add('Node.js');
  } else if (['requirements.txt', 'setup.py', 'pipfile'].includes(lowerFileName)) {
    structure.technologies.add('Python');
  } else if (['pom.xml', 'build.gradle'].includes(lowerFileName)) {
    structure.technologies.add('Java');
  } else if (lowerFileName.includes('docker')) {
    structure.technologies.add('Docker');
  } else if (['.tf', '.tfvars'].includes(ext)) {
    structure.technologies.add('Terraform');
  } else if (lowerFileName.includes('cloudformation') || (ext === '.yaml' && filePath.includes('cloudformation'))) {
    structure.technologies.add('CloudFormation');
  } else if (lowerFileName.includes('serverless')) {
    structure.technologies.add('Serverless Framework');
  } else if (lowerFileName.includes('kubernetes') || lowerFileName.includes('k8s')) {
    structure.technologies.add('Kubernetes');
  }
}

// Helper function to detect Infrastructure as Code type
function detectIaCType(fileName, ext, content) {
  const lowerFileName = fileName.toLowerCase();
  const lowerContent = content.toLowerCase();

  // Terraform
  if (['.tf', '.tfvars'].includes(ext) || lowerFileName.includes('terraform')) {
    return 'terraform';
  }

  // CloudFormation
  if (lowerContent.includes('awstemplateformatversion') || 
      lowerContent.includes('cloudformation') ||
      lowerFileName.includes('cloudformation') ||
      lowerFileName.includes('cfn') ||
      lowerFileName.includes('template')) {
    return 'cloudformation';
  }

  // AWS SAM
  if (lowerContent.includes('transform') && lowerContent.includes('sam-')) {
    return 'sam';
  }

  // AWS CDK
  if (lowerFileName.includes('cdk') || lowerContent.includes('aws-cdk')) {
    return 'cdk';
  }

  // Serverless Framework
  if (lowerFileName.includes('serverless') || lowerContent.includes('serverless')) {
    return 'serverless';
  }

  // Kubernetes
  if (lowerContent.includes('apiversion') && lowerContent.includes('kind')) {
    return 'kubernetes';
  }

  // Default to generic IaC
  return 'iac';
}

export { router as analysisRoutes }; 