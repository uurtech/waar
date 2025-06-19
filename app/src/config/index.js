import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ConfigManager {
  constructor() {
    this.config = null;
    this.configPaths = [
      '/var/app/config/config.json',      // Mounted config file (Docker)
      '/var/app/config.json',             // Root config file
      path.join(__dirname, '../../config.json'), // Local config file
      path.join(__dirname, '../../config.json.example') // Example config
    ];
  }

  async loadConfig() {
    if (this.config) {
      return this.config;
    }

    // Try to load from config files
    for (const configPath of this.configPaths) {
      try {
        const configData = await fs.readFile(configPath, 'utf8');
        const fileConfig = JSON.parse(configData);
        console.log(`✅ Configuration loaded from: ${configPath}`);
        
        this.config = this.mergeWithEnvironment(fileConfig);
        return this.config;
      } catch (error) {
        // Continue to next config path
        continue;
      }
    }

    // Fallback to environment variables only
    console.log('⚠️  No config file found, using environment variables only');
    this.config = this.loadFromEnvironment();
    return this.config;
  }

  mergeWithEnvironment(fileConfig) {
    return {
      aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || fileConfig.aws?.accessKeyId,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || fileConfig.aws?.secretAccessKey,
        region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || fileConfig.aws?.region || 'us-east-1'
      },
      bedrock: {
        agentId: process.env.BEDROCK_AGENT_ID || fileConfig.bedrock?.agentId,
        agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || fileConfig.bedrock?.agentAliasId || 'TSTALIASID',
        region: process.env.BEDROCK_REGION || process.env.AWS_DEFAULT_REGION || fileConfig.bedrock?.region || 'us-east-1',
        modelId: process.env.BEDROCK_MODEL_ID || fileConfig.bedrock?.modelId || 'anthropic.claude-3-sonnet-20240229-v1:0',
        agentOnly: this.parseBoolean(process.env.BEDROCK_AGENT_ONLY) ?? fileConfig.bedrock?.agentOnly ?? false
      },
      application: {
        port: parseInt(process.env.PORT) || fileConfig.application?.port || 8080,
        logLevel: process.env.LOG_LEVEL || fileConfig.application?.logLevel || 'info',
        databasePath: process.env.DATABASE_PATH || fileConfig.application?.databasePath || '/var/app/data/well_architected.db',
        nodeEnv: process.env.NODE_ENV || 'production'
      }
    };
  }

  loadFromEnvironment() {
    return {
      aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1'
      },
      bedrock: {
        agentId: process.env.BEDROCK_AGENT_ID,
        agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID',
        region: process.env.BEDROCK_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
        modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0',
        agentOnly: this.parseBoolean(process.env.BEDROCK_AGENT_ONLY) ?? false
      },
      application: {
        port: parseInt(process.env.PORT) || 8080,
        logLevel: process.env.LOG_LEVEL || 'info',
        databasePath: process.env.DATABASE_PATH || '/var/app/data/well_architected.db',
        nodeEnv: process.env.NODE_ENV || 'production'
      }
    };
  }

  parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === '1';
    }
    return null;
  }

  validateConfig() {
    const config = this.config;
    const errors = [];

    // Validate AWS credentials
    if (!config.aws.accessKeyId) {
      errors.push('AWS Access Key ID is required');
    }
    if (!config.aws.secretAccessKey) {
      errors.push('AWS Secret Access Key is required');
    }

    // Validate Bedrock configuration
    if (!config.bedrock.agentId) {
      if (config.bedrock.agentOnly) {
        errors.push('Bedrock Agent ID is required when agentOnly mode is enabled');
      } else {
        console.log('⚠️  No Bedrock Agent ID provided, will use direct model invocation');
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }

    return true;
  }

  get() {
    return this.config;
  }

  getAws() {
    return this.config?.aws;
  }

  getBedrock() {
    return this.config?.bedrock;
  }

  getApplication() {
    return this.config?.application;
  }

  isAgentOnlyMode() {
    return this.config?.bedrock?.agentOnly === true;
  }

  hasAgentId() {
    return !!this.config?.bedrock?.agentId;
  }

  logConfiguration() {
    console.log('\n🔧 Configuration Summary:');
    console.log('========================');
    console.log(`AWS Region: ${this.config.aws.region}`);
    console.log(`AWS Access Key: ${this.config.aws.accessKeyId ? '***configured***' : 'NOT SET'}`);
    console.log(`AWS Secret Key: ${this.config.aws.secretAccessKey ? '***configured***' : 'NOT SET'}`);
    console.log(`Bedrock Agent ID: ${this.config.bedrock.agentId || 'NOT SET'}`);
    console.log(`Bedrock Agent Alias: ${this.config.bedrock.agentAliasId}`);
    console.log(`Bedrock Region: ${this.config.bedrock.region}`);
    console.log(`Agent Only Mode: ${this.config.bedrock.agentOnly ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Application Port: ${this.config.application.port}`);
    console.log(`Log Level: ${this.config.application.logLevel}`);
    console.log('========================\n');
  }
}

// Create singleton instance
const configManager = new ConfigManager();

export default configManager; 