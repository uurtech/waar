import { fromIni, fromEnv, fromContainerMetadata, fromInstanceMetadata } from '@aws-sdk/credential-providers';
import { CostExplorerClient, GetDimensionValuesCommand, GetRightsizingRecommendationCommand } from '@aws-sdk/client-cost-explorer';
import { IAMClient, GenerateCredentialReportCommand, GetCredentialReportCommand, ListUsersCommand, ListRolesCommand } from '@aws-sdk/client-iam';
import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AWSService {
  constructor() {
    this.credentials = null;
    this.region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
    this.costExplorerClient = null;
    this.iamClient = null;
    this.ec2Client = null;
  }

  async initialize() {
    try {
      // Initialize credentials with multiple fallback methods
      this.credentials = await this.initializeCredentials();
      
      // Initialize AWS service clients
      const clientConfig = {
        region: this.region,
        credentials: this.credentials
      };

      this.costExplorerClient = new CostExplorerClient(clientConfig);
      this.iamClient = new IAMClient(clientConfig);
      this.ec2Client = new EC2Client(clientConfig);

      console.log('✅ AWS services initialized successfully');
      console.log(`📍 Region: ${this.region}`);
    } catch (error) {
      console.error('❌ Failed to initialize AWS services:', error.message);
      throw error;
    }
  }

  async initializeCredentials() {
    const credentialProviders = [
      // 1. Environment variables
      fromEnv(),
      
      // 2. AWS credentials file
      fromIni({
        profile: process.env.AWS_PROFILE || 'default',
        filepath: process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(process.env.HOME || '/root', '.aws', 'credentials'),
        configFilepath: process.env.AWS_CONFIG_FILE || path.join(process.env.HOME || '/root', '.aws', 'config')
      }),
      
      // 3. Container metadata (for ECS)
      fromContainerMetadata(),
      
      // 4. Instance metadata (for EC2)
      fromInstanceMetadata()
    ];

    for (const provider of credentialProviders) {
      try {
        const credentials = await provider();
        console.log('✅ Successfully loaded AWS credentials');
        return credentials;
      } catch (error) {
        console.log(`⚠️  Credential provider failed: ${error.message}`);
        continue;
      }
    }

    throw new Error('No valid AWS credentials found. Please check your configuration.');
  }

  // Cost Explorer MCP Integration
  async analyzeCosts(options = {}) {
    try {
      const {
        startDate = this.getDateDaysAgo(30),
        endDate = this.getDateDaysAgo(1),
        granularity = 'MONTHLY',
        metrics = ['BlendedCost']
      } = options;

      const command = new GetDimensionValuesCommand({
        TimePeriod: {
          Start: startDate,
          End: endDate
        },
        Dimension: 'SERVICE',
        Context: 'COST_AND_USAGE'
      });

      const response = await this.costExplorerClient.send(command);
      
      return {
        success: true,
        data: {
          services: response.DimensionValues || [],
          period: { startDate, endDate },
          recommendations: await this.getCostRecommendations()
        }
      };
    } catch (error) {
      console.error('Cost analysis error:', error);
      return {
        success: false,
        error: error.message,
        recommendations: []
      };
    }
  }

  async getCostRecommendations() {
    try {
      const command = new GetRightsizingRecommendationCommand({
        Service: 'AmazonEC2',
        Configuration: {
          BenefitsConsidered: true,
          RecommendationTarget: 'SAME_INSTANCE_FAMILY'
        }
      });

      const response = await this.costExplorerClient.send(command);
      return response.RightsizingRecommendations || [];
    } catch (error) {
      console.error('Cost recommendations error:', error);
      return [];
    }
  }

  // IAM Analyzer MCP Integration
  async analyzeIAM() {
    try {
      // Generate credential report
      await this.generateCredentialReport();
      
      // Wait a bit for report generation
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const [credentialReport, users, roles] = await Promise.all([
        this.getCredentialReport(),
        this.listUsers(),
        this.listRoles()
      ]);

      return {
        success: true,
        data: {
          credentialReport,
          users: users.Users || [],
          roles: roles.Roles || [],
          analysis: this.analyzeIAMSecurity(users.Users, roles.Roles)
        }
      };
    } catch (error) {
      console.error('IAM analysis error:', error);
      return {
        success: false,
        error: error.message,
        recommendations: []
      };
    }
  }

  async generateCredentialReport() {
    const command = new GenerateCredentialReportCommand({});
    return await this.iamClient.send(command);
  }

  async getCredentialReport() {
    try {
      const command = new GetCredentialReportCommand({});
      const response = await this.iamClient.send(command);
      
      if (response.Content) {
        const csvContent = Buffer.from(response.Content).toString('utf-8');
        return this.parseCredentialReport(csvContent);
      }
      return null;
    } catch (error) {
      console.error('Error getting credential report:', error);
      return null;
    }
  }

  async listUsers() {
    const command = new ListUsersCommand({});
    return await this.iamClient.send(command);
  }

  async listRoles() {
    const command = new ListRolesCommand({});
    return await this.iamClient.send(command);
  }

  analyzeIAMSecurity(users, roles) {
    const analysis = {
      recommendations: [],
      riskLevel: 'LOW',
      findings: []
    };

    // Analyze users
    users.forEach(user => {
      if (!user.PasswordLastUsed && user.CreateDate) {
        const daysSinceCreation = Math.floor((new Date() - new Date(user.CreateDate)) / (1000 * 60 * 60 * 24));
        if (daysSinceCreation > 90) {
          analysis.findings.push({
            type: 'UNUSED_USER',
            resource: user.UserName,
            description: `User has never logged in and was created ${daysSinceCreation} days ago`
          });
        }
      }
    });

    // Analyze roles
    roles.forEach(role => {
      if (role.AssumeRolePolicyDocument) {
        try {
          const policy = JSON.parse(decodeURIComponent(role.AssumeRolePolicyDocument));
          if (policy.Statement.some(stmt => stmt.Principal === '*')) {
            analysis.findings.push({
              type: 'OVERPRIVILEGED_ROLE',
              resource: role.RoleName,
              description: 'Role allows assumption by any principal (*)'
            });
            analysis.riskLevel = 'HIGH';
          }
        } catch (error) {
          // Policy parsing error
        }
      }
    });

    return analysis;
  }

  // Compute Analyzer MCP Integration
  async analyzeCompute() {
    try {
      const [instances, volumes, securityGroups] = await Promise.all([
        this.describeInstances(),
        this.describeVolumes(),
        this.describeSecurityGroups()
      ]);

      return {
        success: true,
        data: {
          instances: instances.Reservations?.flatMap(r => r.Instances) || [],
          volumes: volumes.Volumes || [],
          securityGroups: securityGroups.SecurityGroups || [],
          analysis: this.analyzeComputeResources(instances, volumes, securityGroups)
        }
      };
    } catch (error) {
      console.error('Compute analysis error:', error);
      return {
        success: false,
        error: error.message,
        recommendations: []
      };
    }
  }

  async describeInstances() {
    const command = new DescribeInstancesCommand({});
    return await this.ec2Client.send(command);
  }

  async describeVolumes() {
    const command = new DescribeVolumesCommand({});
    return await this.ec2Client.send(command);
  }

  async describeSecurityGroups() {
    const command = new DescribeSecurityGroupsCommand({});
    return await this.ec2Client.send(command);
  }

  analyzeComputeResources(instances, volumes, securityGroups) {
    const analysis = {
      recommendations: [],
      findings: []
    };

    // Analyze instances
    const allInstances = instances.Reservations?.flatMap(r => r.Instances) || [];
    allInstances.forEach(instance => {
      if (instance.State?.Name === 'stopped') {
        analysis.findings.push({
          type: 'STOPPED_INSTANCE',
          resource: instance.InstanceId,
          description: 'Instance is stopped but still incurring costs'
        });
      }

      if (instance.InstanceType?.includes('t2.micro') || instance.InstanceType?.includes('t3.micro')) {
        analysis.recommendations.push({
          type: 'INSTANCE_UPGRADE',
          resource: instance.InstanceId,
          description: 'Consider upgrading to newer generation instances for better performance'
        });
      }
    });

    // Analyze security groups
    const sgData = securityGroups.SecurityGroups || [];
    sgData.forEach(sg => {
      sg.IpPermissions?.forEach(rule => {
        if (rule.IpRanges?.some(range => range.CidrIp === '0.0.0.0/0')) {
          analysis.findings.push({
            type: 'OPEN_SECURITY_GROUP',
            resource: sg.GroupId,
            description: 'Security group allows access from anywhere (0.0.0.0/0)'
          });
        }
      });
    });

    return analysis;
  }

  // Helper methods
  parseCredentialReport(csvContent) {
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',');
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim()) {
        const values = lines[i].split(',');
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index];
        });
        data.push(row);
      }
    }

    return data;
  }

  getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  // Test connection
  async testConnection() {
    try {
      await this.iamClient.send(new ListUsersCommand({ MaxItems: 1 }));
      return { success: true, message: 'AWS connection successful' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
} 