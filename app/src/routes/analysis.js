import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import yauzl from 'yauzl';
import { promisify } from 'util';
import db from '../database/init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.zip', '.tar', '.gz', '.rar'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext) || file.mimetype.includes('zip') || file.mimetype.includes('tar')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload a zip, tar, or rar file.'));
    }
  }
});

// Upload and analyze codebase
router.post('/upload', upload.single('codebase'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const sessionId = uuidv4();
    const bedrockService = req.app.locals.bedrockService();
    const awsService = req.app.locals.awsService();
    const logger = req.app.locals.logger;

    logger.info(`Starting analysis for session ${sessionId}`);

    // Create analysis session
    await db.run(
      'INSERT INTO analysis_sessions (id, codebase_path, analysis_status) VALUES (?, ?, ?)',
      [sessionId, req.file.path, 'processing']
    );

    // Extract and analyze codebase
    const extractedPath = await extractCodebase(req.file.path, sessionId);
    const codebaseStructure = await analyzeCodebaseStructure(extractedPath);

    // Get AWS analysis data
    const [costAnalysis, iamAnalysis, computeAnalysis] = await Promise.all([
      awsService.analyzeCosts(),
      awsService.analyzeIAM(),
      awsService.analyzeCompute()
    ]);

    // Analyze with Bedrock
    const analysisResult = await bedrockService.analyzeCodebase(codebaseStructure, {
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

    logger.info(`Analysis completed for session ${sessionId}`);

    res.json({
      success: true,
      sessionId,
      analysis: analysisResult.analysis,
      message: 'Codebase analyzed successfully'
    });

  } catch (error) {
    req.app.locals.logger.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
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

// Helper functions
async function extractCodebase(filePath, sessionId) {
  const extractDir = path.join(path.dirname(filePath), `extracted_${sessionId}`);
  await fs.mkdir(extractDir, { recursive: true });

  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory entry
          zipfile.readEntry();
        } else {
          // File entry
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(err);
              return;
            }

            const outputPath = path.join(extractDir, entry.fileName);
            fs.mkdir(path.dirname(outputPath), { recursive: true }).then(() => {
              const writeStream = require('fs').createWriteStream(outputPath);
              readStream.pipe(writeStream);
              readStream.on('end', () => {
                zipfile.readEntry();
              });
            });
          });
        }
      });

      zipfile.on('end', () => {
        resolve(extractDir);
      });

      zipfile.on('error', reject);
    });
  });
}

async function analyzeCodebaseStructure(extractedPath) {
  const structure = {
    files: [],
    directories: [],
    technologies: new Set(),
    totalFiles: 0,
    totalSize: 0
  };

  async function scanDirectory(dirPath, relativePath = '') {
    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const itemRelativePath = path.join(relativePath, item.name);

      if (item.isDirectory()) {
        structure.directories.push(itemRelativePath);
        await scanDirectory(fullPath, itemRelativePath);
      } else {
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
        } else if (['.cpp', '.cc', '.cxx'].includes(ext)) {
          structure.technologies.add('C++');
        } else if (['.dockerfile', 'dockerfile'].includes(item.name.toLowerCase())) {
          structure.technologies.add('Docker');
        } else if (['package.json', 'yarn.lock', 'package-lock.json'].includes(item.name.toLowerCase())) {
          structure.technologies.add('Node.js');
        } else if (['requirements.txt', 'setup.py', 'pipfile'].includes(item.name.toLowerCase())) {
          structure.technologies.add('Python');
        } else if (['pom.xml', 'build.gradle'].includes(item.name.toLowerCase())) {
          structure.technologies.add('Java');
        } else if (['terraform', '.tf'].includes(ext)) {
          structure.technologies.add('Terraform');
        } else if (['cloudformation', '.yaml', '.yml'].includes(ext)) {
          structure.technologies.add('CloudFormation');
        }
      }
    }
  }

  await scanDirectory(extractedPath);
  structure.technologies = Array.from(structure.technologies);
  
  return structure;
}

export { router as analysisRoutes }; 