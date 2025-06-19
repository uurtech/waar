import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Database {
  constructor() {
    this.db = null;
  }

  async initialize() {
    const dbPath = path.join(__dirname, '../../data/well_architected.db');
    
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Connected to SQLite database');
          resolve();
        }
      });
    });
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        }
        console.log('Database connection closed');
        resolve();
      });
    });
  }
}

const db = new Database();

export const initializeDatabase = async () => {
  await db.initialize();
  
  // Create tables
  await createTables();
  
  // Insert default Well-Architected questions
  await insertDefaultQuestions();
  
  return db;
};

const createTables = async () => {
  // Well-Architected pillars
  await db.run(`
    CREATE TABLE IF NOT EXISTS pillars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Well-Architected questions
  await db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pillar_id INTEGER,
      question_text TEXT NOT NULL,
      question_key TEXT UNIQUE,
      category TEXT,
      priority INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pillar_id) REFERENCES pillars (id)
    )
  `);

  // User answers
  await db.run(`
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER,
      session_id TEXT,
      answer_text TEXT,
      confidence_score REAL,
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (question_id) REFERENCES questions (id)
    )
  `);

  // Analysis sessions
  await db.run(`
    CREATE TABLE IF NOT EXISTS analysis_sessions (
      id TEXT PRIMARY KEY,
      codebase_path TEXT,
      analysis_status TEXT DEFAULT 'pending',
      bedrock_analysis TEXT,
      recommendations TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // MCP analysis results
  await db.run(`
    CREATE TABLE IF NOT EXISTS mcp_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      analysis_type TEXT,
      results TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES analysis_sessions (id)
    )
  `);

  console.log('Database tables created successfully');
};

const insertDefaultQuestions = async () => {
  // Insert pillars
  const pillars = [
    { name: 'Operational Excellence', description: 'The ability to support development and run workloads effectively' },
    { name: 'Security', description: 'The ability to protect data, systems, and assets' },
    { name: 'Reliability', description: 'The ability to recover from infrastructure or service disruptions' },
    { name: 'Performance Efficiency', description: 'The ability to use computing resources efficiently' },
    { name: 'Cost Optimization', description: 'The ability to run systems to deliver business value at the lowest price point' },
    { name: 'Sustainability', description: 'The ability to continually improve sustainability impacts' }
  ];

  for (const pillar of pillars) {
    try {
      await db.run(
        'INSERT OR IGNORE INTO pillars (name, description) VALUES (?, ?)',
        [pillar.name, pillar.description]
      );
    } catch (error) {
      // Pillar already exists, continue
    }
  }

  // Sample questions for each pillar
  const questions = [
    // Operational Excellence
    { pillar: 'Operational Excellence', key: 'OPS01', text: 'How do you determine what your priorities are?', category: 'Organization' },
    { pillar: 'Operational Excellence', key: 'OPS02', text: 'How do you structure your organization to support your business outcomes?', category: 'Organization' },
    { pillar: 'Operational Excellence', key: 'OPS03', text: 'How does your organizational culture support your business outcomes?', category: 'Organization' },
    { pillar: 'Operational Excellence', key: 'OPS04', text: 'How do you design your workload so that you can understand its state?', category: 'Prepare' },
    { pillar: 'Operational Excellence', key: 'OPS05', text: 'How do you reduce defects, ease remediation, and improve flow into production?', category: 'Prepare' },
    
    // Security
    { pillar: 'Security', key: 'SEC01', text: 'How do you securely operate your workload?', category: 'Security Foundations' },
    { pillar: 'Security', key: 'SEC02', text: 'How do you manage identities for people and machines?', category: 'Identity and Access Management' },
    { pillar: 'Security', key: 'SEC03', text: 'How do you manage permissions for people and machines?', category: 'Identity and Access Management' },
    { pillar: 'Security', key: 'SEC04', text: 'How do you detect and investigate security events?', category: 'Detection' },
    { pillar: 'Security', key: 'SEC05', text: 'How do you protect your network resources?', category: 'Infrastructure Protection' },
    
    // Reliability
    { pillar: 'Reliability', key: 'REL01', text: 'How do you manage service quotas and constraints?', category: 'Foundations' },
    { pillar: 'Reliability', key: 'REL02', text: 'How do you plan your network topology?', category: 'Foundations' },
    { pillar: 'Reliability', key: 'REL03', text: 'How do you design your workload service architecture?', category: 'Workload Architecture' },
    { pillar: 'Reliability', key: 'REL04', text: 'How do you design interactions in a distributed system to prevent failures?', category: 'Workload Architecture' },
    { pillar: 'Reliability', key: 'REL05', text: 'How do you design interactions in a distributed system to mitigate or withstand failures?', category: 'Workload Architecture' },
    
    // Performance Efficiency
    { pillar: 'Performance Efficiency', key: 'PERF01', text: 'How do you select the best performing architecture?', category: 'Selection' },
    { pillar: 'Performance Efficiency', key: 'PERF02', text: 'How do you select your compute solution?', category: 'Selection' },
    { pillar: 'Performance Efficiency', key: 'PERF03', text: 'How do you select your storage solution?', category: 'Selection' },
    { pillar: 'Performance Efficiency', key: 'PERF04', text: 'How do you select your database solution?', category: 'Selection' },
    { pillar: 'Performance Efficiency', key: 'PERF05', text: 'How do you configure your networking solution?', category: 'Selection' },
    
    // Cost Optimization
    { pillar: 'Cost Optimization', key: 'COST01', text: 'How do you implement cloud financial management?', category: 'Practice Cloud Financial Management' },
    { pillar: 'Cost Optimization', key: 'COST02', text: 'How do you govern usage?', category: 'Expenditure and Usage Awareness' },
    { pillar: 'Cost Optimization', key: 'COST03', text: 'How do you monitor usage and cost?', category: 'Expenditure and Usage Awareness' },
    { pillar: 'Cost Optimization', key: 'COST04', text: 'How do you decommission resources?', category: 'Expenditure and Usage Awareness' },
    { pillar: 'Cost Optimization', key: 'COST05', text: 'How do you evaluate cost when you select services?', category: 'Cost-Effective Resources' },
    
    // Sustainability
    { pillar: 'Sustainability', key: 'SUS01', text: 'How do you select AWS Regions for your workload?', category: 'Region Selection' },
    { pillar: 'Sustainability', key: 'SUS02', text: 'How do you take advantage of user behavior patterns?', category: 'User Behavior Patterns' },
    { pillar: 'Sustainability', key: 'SUS03', text: 'How do you take advantage of software and architecture patterns?', category: 'Software and Architecture Patterns' },
    { pillar: 'Sustainability', key: 'SUS04', text: 'How do you take advantage of data patterns?', category: 'Data Patterns' },
    { pillar: 'Sustainability', key: 'SUS05', text: 'How do you select and use hardware patterns for your workload?', category: 'Hardware Patterns' }
  ];

  for (const question of questions) {
    try {
      // Get pillar ID
      const pillar = await db.get('SELECT id FROM pillars WHERE name = ?', [question.pillar]);
      if (pillar) {
        await db.run(
          'INSERT OR IGNORE INTO questions (pillar_id, question_key, question_text, category) VALUES (?, ?, ?, ?)',
          [pillar.id, question.key, question.text, question.category]
        );
      }
    } catch (error) {
      console.error('Error inserting question:', error);
    }
  }

  console.log('Default Well-Architected questions inserted successfully');
};

export { db };
export default db; 