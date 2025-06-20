import { fromIni, fromEnv, fromContainerMetadata, fromInstanceMetadata } from '@aws-sdk/credential-providers';
import { CostExplorerClient, GetDimensionValuesCommand, GetRightsizingRecommendationCommand, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { IAMClient, GenerateCredentialReportCommand, GetCredentialReportCommand, ListUsersCommand, ListRolesCommand, ListPoliciesCommand } from '@aws-sdk/client-iam';
import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { SupportClient, DescribeTrustedAdvisorChecksCommand, DescribeTrustedAdvisorCheckResultCommand } from '@aws-sdk/client-support';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudTrailClient, LookupEventsCommand } from '@aws-sdk/client-cloudtrail';
import { ConfigServiceClient, GetComplianceDetailsByConfigRuleCommand, DescribeConfigRulesCommand } from '@aws-sdk/client-config-service';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AWSService {
  constructor() {
    this.credentials = null;
    this.region = null;
    this.costExplorerClient = null;
    this.iamClient = null;
    this.ec2Client = null;
    this.supportClient = null;
    this.cloudWatchClient = null;
    this.cloudTrailClient = null;
    this.configClient = null;
  }

  async initialize(awsConfig) {
    try {
      this.region = awsConfig.region || 'us-east-1';
      
      // Set up credentials
      if (awsConfig.accessKeyId && awsConfig.secretAccessKey) {
        // Use provided credentials
        this.credentials = {
          accessKeyId: awsConfig.accessKeyId,
          secretAccessKey: awsConfig.secretAccessKey,
          ...(awsConfig.sessionToken && { sessionToken: awsConfig.sessionToken })
        };
        console.log('✅ Using provided AWS credentials');
      } else {
        // Try to use credential providers (environment, profile, instance role)
        try {
          this.credentials = fromEnv();
          console.log('✅ Using AWS credentials from environment');
        } catch (envError) {
          try {
            this.credentials = fromIni();
            console.log('✅ Using AWS credentials from profile');
          } catch (profileError) {
            throw new Error('No AWS credentials found. Please provide credentials via config file or environment variables.');
          }
        }
      }

      const clientConfig = {
        region: this.region,
        credentials: this.credentials
      };

      // Initialize AWS clients
      this.costExplorerClient = new CostExplorerClient(clientConfig);
      this.iamClient = new IAMClient(clientConfig);
      this.ec2Client = new EC2Client(clientConfig);
      this.supportClient = new SupportClient(clientConfig);
      this.cloudWatchClient = new CloudWatchClient(clientConfig);
      this.cloudTrailClient = new CloudTrailClient(clientConfig);
      this.configClient = new ConfigServiceClient(clientConfig);

      console.log(`✅ AWS services initialized for region: ${this.region}`);
      return true;

    } catch (error) {
      console.error('❌ Failed to initialize AWS services:', error);
      throw error;
    }
  }

  async analyzeCosts() {
    try {
      console.log('📊 Starting cost analysis...');
      
      // Get cost and usage data for the last 30 days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const costCommand = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: startDate.toISOString().split('T')[0],
          End: endDate.toISOString().split('T')[0]
        },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        GroupBy: [
          {
            Type: 'DIMENSION',
            Key: 'SERVICE'
          }
        ]
      });

      const costData = await this.costExplorerClient.send(costCommand);

      // Get rightsizing recommendations
      let rightsizingData = null;
      try {
        const rightsizingCommand = new GetRightsizingRecommendationCommand({
          Service: 'AmazonEC2'
        });
        rightsizingData = await this.costExplorerClient.send(rightsizingCommand);
      } catch (rightsizingError) {
        console.warn('⚠️ Could not fetch rightsizing recommendations:', rightsizingError.message);
      }

      const analysis = {
        totalCost: this.calculateTotalCost(costData),
        topServices: this.getTopServices(costData),
        costTrend: this.analyzeCostTrend(costData),
        rightsizingRecommendations: rightsizingData?.RightsizingRecommendations || [],
        recommendations: this.generateCostRecommendations(costData, rightsizingData)
      };

      console.log('✅ Cost analysis completed');
      return {
        success: true,
        data: analysis
      };

    } catch (error) {
      console.error('❌ Cost analysis failed:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async analyzeIAM() {
    try {
      console.log('🔐 Starting IAM analysis...');

      // Generate credential report
      try {
        await this.iamClient.send(new GenerateCredentialReportCommand({}));
        // Wait a moment for report generation
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.warn('⚠️ Could not generate credential report:', error.message);
      }

      // Get credential report
      let credentialReport = null;
      try {
        const reportResponse = await this.iamClient.send(new GetCredentialReportCommand({}));
        if (reportResponse.Content) {
          const csvContent = Buffer.from(reportResponse.Content).toString('utf-8');
          credentialReport = this.parseCredentialReport(csvContent);
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch credential report:', error.message);
      }

      // Get policies
      let policies = [];
      try {
        const policiesResponse = await this.iamClient.send(new ListPoliciesCommand({
          Scope: 'Local',
          MaxItems: 100
        }));
        policies = policiesResponse.Policies || [];
      } catch (error) {
        console.warn('⚠️ Could not fetch policies:', error.message);
      }

      const analysis = {
        credentialReport,
        customPolicies: policies,
        securityFindings: this.analyzeSecurityFindings(credentialReport, policies),
        recommendations: this.generateIAMRecommendations(credentialReport, policies)
      };

      console.log('✅ IAM analysis completed');
      return {
        success: true,
        data: analysis
      };

    } catch (error) {
      console.error('❌ IAM analysis failed:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  async analyzeCompute() {
    try {
      console.log('🖥️ Starting compute analysis...');

      // Get EC2 instances
      const instancesResponse = await this.ec2Client.send(new DescribeInstancesCommand({}));
      const instances = [];
      
      instancesResponse.Reservations?.forEach(reservation => {
        reservation.Instances?.forEach(instance => {
          instances.push({
            instanceId: instance.InstanceId,
            instanceType: instance.InstanceType,
            state: instance.State?.Name,
            launchTime: instance.LaunchTime,
            platform: instance.Platform || 'Linux',
            vpcId: instance.VpcId,
            subnetId: instance.SubnetId
          });
        });
      });

      // Get EBS volumes
      const volumesResponse = await this.ec2Client.send(new DescribeVolumesCommand({}));
      const volumes = volumesResponse.Volumes?.map(volume => ({
        volumeId: volume.VolumeId,
        size: volume.Size,
        volumeType: volume.VolumeType,
        state: volume.State,
        encrypted: volume.Encrypted,
        attachments: volume.Attachments
      })) || [];

      const analysis = {
        instances,
        volumes,
        instanceAnalysis: this.analyzeInstances(instances),
        volumeAnalysis: this.analyzeVolumes(volumes),
        recommendations: this.generateComputeRecommendations(instances, volumes)
      };

      console.log('✅ Compute analysis completed');
      return {
        success: true,
        data: analysis
      };

    } catch (error) {
      console.error('❌ Compute analysis failed:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  // Helper methods for cost analysis
  calculateTotalCost(costData) {
    let total = 0;
    costData.ResultsByTime?.forEach(result => {
      result.Total?.UnblendedCost?.Amount && (total += parseFloat(result.Total.UnblendedCost.Amount));
    });
    return total.toFixed(2);
  }

  getTopServices(costData) {
    const servicesCosts = {};
    
    costData.ResultsByTime?.forEach(result => {
      result.Groups?.forEach(group => {
        const service = group.Keys?.[0];
        const cost = parseFloat(group.Metrics?.UnblendedCost?.Amount || 0);
        if (service) {
          servicesCosts[service] = (servicesCosts[service] || 0) + cost;
        }
      });
    });

    return Object.entries(servicesCosts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([service, cost]) => ({ service, cost: cost.toFixed(2) }));
  }

  analyzeCostTrend(costData) {
    const dailyCosts = costData.ResultsByTime?.map(result => ({
      date: result.TimePeriod?.Start,
      cost: parseFloat(result.Total?.UnblendedCost?.Amount || 0)
    })) || [];

    if (dailyCosts.length < 2) return 'insufficient_data';

    const recentCost = dailyCosts.slice(-7).reduce((sum, day) => sum + day.cost, 0) / 7;
    const previousCost = dailyCosts.slice(-14, -7).reduce((sum, day) => sum + day.cost, 0) / 7;

    if (recentCost > previousCost * 1.1) return 'increasing';
    if (recentCost < previousCost * 0.9) return 'decreasing';
    return 'stable';
  }

  generateCostRecommendations(costData, rightsizingData) {
    const recommendations = [];

    // Add rightsizing recommendations
    rightsizingData?.RightsizingRecommendations?.forEach(rec => {
      recommendations.push({
        type: 'rightsizing',
        title: 'Instance Rightsizing Opportunity',
        description: `Consider ${rec.RightsizingType} for instance ${rec.CurrentInstance?.ResourceId}`,
        estimatedSavings: rec.EstimatedMonthlySavings,
        priority: 'high'
      });
    });

    // Generic recommendations
    recommendations.push({
      type: 'monitoring',
      title: 'Cost Monitoring',
      description: 'Set up billing alerts and cost budgets to monitor spending',
      priority: 'medium'
    });

    return recommendations;
  }

  // Helper methods for IAM analysis
  parseCredentialReport(csvContent) {
    const lines = csvContent.split('\n');
    const headers = lines[0]?.split(',') || [];
    const users = [];

    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim()) {
        const values = lines[i].split(',');
        const user = {};
        headers.forEach((header, index) => {
          user[header] = values[index];
        });
        users.push(user);
      }
    }

    return users;
  }

  analyzeSecurityFindings(credentialReport, policies) {
    const findings = [];

    // Analyze credential report
    credentialReport?.forEach(user => {
      if (user.password_enabled === 'true' && user.mfa_active === 'false') {
        findings.push({
          type: 'mfa_disabled',
          severity: 'high',
          resource: user.user,
          description: 'User has password enabled but MFA is not active'
        });
      }

      if (user.access_key_1_active === 'true' && user.access_key_1_last_used_date === 'N/A') {
        findings.push({
          type: 'unused_access_key',
          severity: 'medium',
          resource: user.user,
          description: 'Access key has never been used'
        });
      }
    });

    return findings;
  }

  generateIAMRecommendations(credentialReport, policies) {
    return [
      {
        type: 'mfa_enforcement',
        title: 'Enable Multi-Factor Authentication',
        description: 'Enforce MFA for all users with console access',
        priority: 'high'
      },
      {
        type: 'access_key_rotation',
        title: 'Regular Access Key Rotation',
        description: 'Implement regular rotation of access keys',
        priority: 'medium'
      },
      {
        type: 'least_privilege',
        title: 'Principle of Least Privilege',
        description: 'Review and minimize permissions for all policies',
        priority: 'high'
      }
    ];
  }

  // Helper methods for compute analysis
  analyzeInstances(instances) {
    const running = instances.filter(i => i.state === 'running').length;
    const stopped = instances.filter(i => i.state === 'stopped').length;
    const instanceTypes = {};

    instances.forEach(instance => {
      instanceTypes[instance.instanceType] = (instanceTypes[instance.instanceType] || 0) + 1;
    });

    return {
      total: instances.length,
      running,
      stopped,
      instanceTypes
    };
  }

  analyzeVolumes(volumes) {
    const attached = volumes.filter(v => v.attachments?.length > 0).length;
    const unattached = volumes.filter(v => v.attachments?.length === 0).length;
    const encrypted = volumes.filter(v => v.encrypted).length;
    const totalSize = volumes.reduce((sum, v) => sum + (v.size || 0), 0);

    return {
      total: volumes.length,
      attached,
      unattached,
      encrypted,
      unencrypted: volumes.length - encrypted,
      totalSize
    };
  }

  generateComputeRecommendations(instances, volumes) {
    const recommendations = [];

    // Check for stopped instances
    const stoppedInstances = instances.filter(i => i.state === 'stopped');
    if (stoppedInstances.length > 0) {
      recommendations.push({
        type: 'stopped_instances',
        title: 'Review Stopped Instances',
        description: `${stoppedInstances.length} stopped instances found. Consider terminating if no longer needed.`,
        priority: 'medium'
      });
    }

    // Check for unattached volumes
    const unattachedVolumes = volumes.filter(v => v.attachments?.length === 0);
    if (unattachedVolumes.length > 0) {
      recommendations.push({
        type: 'unattached_volumes',
        title: 'Clean Up Unattached Volumes',
        description: `${unattachedVolumes.length} unattached volumes found. Consider deleting if no longer needed.`,
        priority: 'high'
      });
    }

    // Check for unencrypted volumes
    const unencryptedVolumes = volumes.filter(v => !v.encrypted);
    if (unencryptedVolumes.length > 0) {
      recommendations.push({
        type: 'volume_encryption',
        title: 'Enable Volume Encryption',
        description: `${unencryptedVolumes.length} unencrypted volumes found. Enable encryption for better security.`,
        priority: 'high'
      });
    }

    return recommendations;
  }

  async analyzeTrustedAdvisor() {
    try {
      console.log('🔍 Starting Trusted Advisor analysis...');

      // Get all available Trusted Advisor checks
      const checksCommand = new DescribeTrustedAdvisorChecksCommand({
        language: 'en'
      });
      
      const checksResponse = await this.supportClient.send(checksCommand);
      const checks = checksResponse.checks || [];

      console.log(`Found ${checks.length} Trusted Advisor checks`);

      // Get results for each check
      const checkResults = [];
      for (const check of checks) {
        try {
          const resultCommand = new DescribeTrustedAdvisorCheckResultCommand({
            checkId: check.id,
            language: 'en'
          });
          
          const result = await this.supportClient.send(resultCommand);
          checkResults.push({
            ...check,
            result: result.result
          });
        } catch (error) {
          console.warn(`Could not get result for check ${check.name}:`, error.message);
        }
      }

      const analysis = {
        totalChecks: checks.length,
        checkResults: checkResults,
        summary: this.summarizeTrustedAdvisorResults(checkResults),
        recommendations: this.generateTrustedAdvisorRecommendations(checkResults)
      };

      console.log('✅ Trusted Advisor analysis completed');
      return {
        success: true,
        data: analysis
      };

    } catch (error) {
      console.error('❌ Trusted Advisor analysis failed:', error);
      
      // Handle specific AWS Support subscription errors
      if (error.name === 'SubscriptionRequiredException' || error.__type === 'SubscriptionRequiredException') {
        return {
          success: false,
          error: 'Premium Support subscription required for Trusted Advisor',
          errorType: 'SUBSCRIPTION_REQUIRED',
          userMessage: 'Trusted Advisor requires AWS Business or Enterprise Support plan. Analysis will continue with other AWS services.',
          data: {
            totalChecks: 0,
            checkResults: [],
            summary: { available: false, reason: 'Premium Support subscription required' },
            recommendations: []
          }
        };
      }

      return {
        success: false,
        error: error.message,
        errorType: 'GENERAL_ERROR',
        userMessage: `Trusted Advisor analysis failed: ${error.message}`,
        data: null
      };
    }
  }

  summarizeTrustedAdvisorResults(checkResults) {
    const summary = {
      error: 0,
      warning: 0,
      ok: 0,
      not_available: 0,
      categories: {}
    };

    checkResults.forEach(check => {
      const status = check.result?.status || 'not_available';
      summary[status] = (summary[status] || 0) + 1;

      const category = check.category;
      if (!summary.categories[category]) {
        summary.categories[category] = { error: 0, warning: 0, ok: 0, not_available: 0 };
      }
      summary.categories[category][status] = (summary.categories[category][status] || 0) + 1;
    });

    return summary;
  }

  generateTrustedAdvisorRecommendations(checkResults) {
    const recommendations = [];

    checkResults.forEach(check => {
      if (check.result?.status === 'error' || check.result?.status === 'warning') {
        recommendations.push({
          category: check.category,
          checkName: check.name,
          status: check.result.status,
          description: check.description,
          recommendation: this.mapTrustedAdvisorToRecommendation(check),
          priority: check.result.status === 'error' ? 'High' : 'Medium'
        });
      }
    });

    return recommendations;
  }

  mapTrustedAdvisorToRecommendation(check) {
    const categoryMappings = {
      'cost_optimizing': 'Review and implement cost optimization strategies',
      'security': 'Address security vulnerabilities and implement best practices',
      'fault_tolerance': 'Improve reliability and fault tolerance mechanisms',
      'performance': 'Optimize performance and resource utilization',
      'service_limits': 'Monitor and adjust service limits as needed'
    };

    return categoryMappings[check.category] || 'Review and address the identified issue';
  }

  async analyzeCloudWatchMetrics() {
    try {
      console.log('📊 Starting CloudWatch metrics analysis...');

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - (7 * 24 * 60 * 60 * 1000)); // Last 7 days

      // Get CPU utilization metrics
      const cpuMetricsCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        StartTime: startTime,
        EndTime: endTime,
        Period: 3600, // 1 hour
        Statistics: ['Average', 'Maximum']
      });

      const cpuMetrics = await this.cloudWatchClient.send(cpuMetricsCommand);

      const analysis = {
        cpuMetrics: cpuMetrics.Datapoints || [],
        performanceInsights: this.analyzePerformanceMetrics(cpuMetrics.Datapoints || [])
      };

      console.log('✅ CloudWatch metrics analysis completed');
      return {
        success: true,
        data: analysis
      };

    } catch (error) {
      console.error('❌ CloudWatch metrics analysis failed:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  analyzePerformanceMetrics(datapoints) {
    if (datapoints.length === 0) {
      return { summary: 'No performance data available' };
    }

    const avgCpu = datapoints.reduce((sum, dp) => sum + dp.Average, 0) / datapoints.length;
    const maxCpu = Math.max(...datapoints.map(dp => dp.Maximum));

    return {
      averageCpuUtilization: avgCpu.toFixed(2),
      maxCpuUtilization: maxCpu.toFixed(2),
      recommendation: avgCpu < 20 ? 'Consider downsizing instances' : 
                     avgCpu > 80 ? 'Consider scaling up or out' : 
                     'CPU utilization is within optimal range'
    };
  }

  async analyzeConfigCompliance() {
    try {
      console.log('⚖️ Starting Config compliance analysis...');

      // Get all config rules
      const rulesCommand = new DescribeConfigRulesCommand({});
      const rulesResponse = await this.configClient.send(rulesCommand);
      const rules = rulesResponse.ConfigRules || [];

      const complianceResults = [];
      for (const rule of rules.slice(0, 10)) { // Limit to first 10 rules
        try {
          const complianceCommand = new GetComplianceDetailsByConfigRuleCommand({
            ConfigRuleName: rule.ConfigRuleName
          });
          
          const compliance = await this.configClient.send(complianceCommand);
          complianceResults.push({
            ruleName: rule.ConfigRuleName,
            description: rule.Description,
            compliance: compliance.EvaluationResults || []
          });
        } catch (error) {
          console.warn(`Could not get compliance for rule ${rule.ConfigRuleName}:`, error.message);
        }
      }

      const analysis = {
        totalRules: rules.length,
        analyzedRules: complianceResults.length,
        complianceResults: complianceResults,
        summary: this.summarizeComplianceResults(complianceResults)
      };

      console.log('✅ Config compliance analysis completed');
      return {
        success: true,
        data: analysis
      };

    } catch (error) {
      console.error('❌ Config compliance analysis failed:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  summarizeComplianceResults(results) {
    const summary = {
      compliant: 0,
      nonCompliant: 0,
      notApplicable: 0
    };

    results.forEach(result => {
      result.compliance.forEach(item => {
        const status = item.ComplianceType;
        if (status === 'COMPLIANT') summary.compliant++;
        else if (status === 'NON_COMPLIANT') summary.nonCompliant++;
        else summary.notApplicable++;
      });
    });

    return summary;
  }

  async performComprehensiveAnalysis() {
    try {
      console.log('🔄 Starting comprehensive AWS analysis...');

      // Run all analyses in parallel, but don't fail if some services are unavailable
      const [
        trustedAdvisorAnalysis,
        costAnalysis,
        iamAnalysis,
        computeAnalysis,
        cloudWatchAnalysis,
        configAnalysis
      ] = await Promise.allSettled([
        this.analyzeTrustedAdvisor(),
        this.analyzeCosts(),
        this.analyzeIAM(),
        this.analyzeCompute(),
        this.analyzeCloudWatchMetrics(),
        this.analyzeConfigCompliance()
      ]);

      // Extract results and collect any errors for user display
      const serviceResults = {
        trustedAdvisor: trustedAdvisorAnalysis.status === 'fulfilled' ? trustedAdvisorAnalysis.value : { success: false, error: 'Analysis failed', data: null },
        cost: costAnalysis.status === 'fulfilled' ? costAnalysis.value : { success: false, error: 'Analysis failed', data: null },
        iam: iamAnalysis.status === 'fulfilled' ? iamAnalysis.value : { success: false, error: 'Analysis failed', data: null },
        compute: computeAnalysis.status === 'fulfilled' ? computeAnalysis.value : { success: false, error: 'Analysis failed', data: null },
        cloudWatch: cloudWatchAnalysis.status === 'fulfilled' ? cloudWatchAnalysis.value : { success: false, error: 'Analysis failed', data: null },
        config: configAnalysis.status === 'fulfilled' ? configAnalysis.value : { success: false, error: 'Analysis failed', data: null }
      };

      // Collect user-friendly error messages
      const serviceErrors = [];
      const serviceWarnings = [];
      
      Object.entries(serviceResults).forEach(([serviceName, result]) => {
        if (!result.success) {
          if (result.errorType === 'SUBSCRIPTION_REQUIRED') {
            serviceWarnings.push({
              service: serviceName,
              message: result.userMessage || result.error,
              type: 'warning'
            });
          } else {
            serviceErrors.push({
              service: serviceName,
              message: result.userMessage || result.error,
              type: 'error'
            });
          }
        }
      });

      const comprehensiveAnalysis = {
        trustedAdvisor: serviceResults.trustedAdvisor.data,
        cost: serviceResults.cost.data,
        iam: serviceResults.iam.data,
        compute: serviceResults.compute.data,
        cloudWatch: serviceResults.cloudWatch.data,
        config: serviceResults.config.data,
        timestamp: new Date().toISOString(),
        serviceStatus: {
          errors: serviceErrors,
          warnings: serviceWarnings,
          successfulServices: Object.entries(serviceResults).filter(([_, result]) => result.success).length,
          totalServices: Object.keys(serviceResults).length
        },
        summary: this.generateComprehensiveSummary({
          trustedAdvisor: serviceResults.trustedAdvisor.data,
          cost: serviceResults.cost.data,
          iam: serviceResults.iam.data,
          compute: serviceResults.compute.data,
          cloudWatch: serviceResults.cloudWatch.data,
          config: serviceResults.config.data
        })
      };

      console.log('✅ Comprehensive AWS analysis completed');
      console.log(`📊 Analysis Summary: ${comprehensiveAnalysis.serviceStatus.successfulServices}/${comprehensiveAnalysis.serviceStatus.totalServices} services successful`);
      
      if (serviceWarnings.length > 0) {
        console.log('⚠️ Service Warnings:', serviceWarnings.map(w => `${w.service}: ${w.message}`).join(', '));
      }
      
      if (serviceErrors.length > 0) {
        console.log('❌ Service Errors:', serviceErrors.map(e => `${e.service}: ${e.message}`).join(', '));
      }

      return {
        success: true,
        data: comprehensiveAnalysis
      };

    } catch (error) {
      console.error('❌ Comprehensive analysis failed:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  generateComprehensiveSummary(analysisData) {
    const summary = {
      overallHealth: 'Good',
      criticalIssues: 0,
      warnings: 0,
      recommendations: [],
      wellArchitectedInsights: {
        operationalExcellence: { score: 4, findings: [] },
        security: { score: 4, findings: [] },
        reliability: { score: 4, findings: [] },
        performanceEfficiency: { score: 4, findings: [] },
        costOptimization: { score: 4, findings: [] },
        sustainability: { score: 4, findings: [] }
      }
    };

    // Analyze Trusted Advisor results
    if (analysisData.trustedAdvisor?.summary) {
      summary.criticalIssues += analysisData.trustedAdvisor.summary.error || 0;
      summary.warnings += analysisData.trustedAdvisor.summary.warning || 0;
    }

    // Analyze cost optimization
    if (analysisData.cost?.rightsizingRecommendations?.length > 0) {
      summary.wellArchitectedInsights.costOptimization.score = 3;
      summary.wellArchitectedInsights.costOptimization.findings.push('Rightsizing opportunities identified');
    }

    // Analyze security
    if (analysisData.iam?.securityFindings?.length > 0) {
      summary.wellArchitectedInsights.security.score = 3;
      summary.wellArchitectedInsights.security.findings.push('IAM security improvements needed');
    }

    // Analyze performance
    if (analysisData.cloudWatch?.performanceInsights) {
      const avgCpu = parseFloat(analysisData.cloudWatch.performanceInsights.averageCpuUtilization);
      if (avgCpu < 20 || avgCpu > 80) {
        summary.wellArchitectedInsights.performanceEfficiency.score = 3;
        summary.wellArchitectedInsights.performanceEfficiency.findings.push('CPU utilization optimization needed');
      }
    }

    // Set overall health
    if (summary.criticalIssues > 0) {
      summary.overallHealth = 'Critical';
    } else if (summary.warnings > 5) {
      summary.overallHealth = 'Needs Improvement';
    }

    return summary;
  }

  async testConnection() {
    try {
      // Simple test to verify AWS connectivity
      await this.iamClient.send(new ListPoliciesCommand({ MaxItems: 1 }));
      return { success: true, message: 'AWS connection successful' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getConfiguration() {
    return {
      region: this.region,
      hasCredentials: !!this.credentials,
      services: {
        costExplorer: !!this.costExplorerClient,
        iam: !!this.iamClient,
        ec2: !!this.ec2Client
      }
    };
  }
} 