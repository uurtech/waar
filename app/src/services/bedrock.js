import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import configManager from '../config/index.js';

export class BedrockService {
  constructor(awsService) {
    this.awsService = awsService;
    this.client = null;
    this.agentClient = null;
    this.config = null;
  }

  async initialize() {
    try {
      this.config = configManager.getBedrock();
      
      const clientConfig = {
        region: this.config.region,
        credentials: this.awsService.credentials
      };

      // Initialize runtime client for direct model invocation (if not agent-only)
      if (!this.config.agentOnly) {
        this.client = new BedrockRuntimeClient(clientConfig);
        console.log(`✅ Bedrock Runtime Client initialized - Model: ${this.config.modelId}`);
      }
      
      // Initialize agent client if agent ID is provided
      if (this.config.agentId) {
        this.agentClient = new BedrockAgentRuntimeClient(clientConfig);
        console.log(`✅ Bedrock Agent Client initialized - Agent: ${this.config.agentId}`);
      }

      // Validate configuration
      if (this.config.agentOnly && !this.config.agentId) {
        throw new Error('Agent-only mode is enabled but no Agent ID is provided');
      }

      if (!this.config.agentId && !this.client) {
        throw new Error('Neither Agent ID nor direct model access is configured');
      }

      console.log('✅ Bedrock service initialized successfully');
      console.log(`🤖 Mode: ${this.config.agentOnly ? 'Agent Only' : 'Hybrid (Agent + Direct Model)'}`);
      
    } catch (error) {
      console.error('❌ Failed to initialize Bedrock service:', error);
      throw error;
    }
  }

  async analyzeCodebase(codebaseStructure, additionalContext = {}) {
    try {
      // Force agent-only mode if configured
      if (this.config.agentOnly) {
        if (!this.config.agentId || !this.agentClient) {
          throw new Error('Agent-only mode is enabled but agent is not properly configured');
        }
        console.log('🤖 Using Agent-only mode for analysis');
        return await this.analyzeWithAgent(codebaseStructure, additionalContext);
      }

      // If agent is configured and available, prefer it over direct model
      if (this.config.agentId && this.agentClient) {
        console.log('🤖 Using Bedrock Agent for analysis');
        return await this.analyzeWithAgent(codebaseStructure, additionalContext);
      }

      // Fallback to direct model invocation
      console.log('📝 Using direct model invocation for analysis');
      return await this.analyzeWithModel(codebaseStructure, additionalContext);
      
    } catch (error) {
      console.error('Bedrock analysis error:', error);
      return {
        success: false,
        error: error.message,
        analysis: null
      };
    }
  }

  async analyzeWithAgent(codebaseStructure, additionalContext) {
    try {
      const prompt = this.buildAnalysisPrompt(codebaseStructure, additionalContext);
      
      const command = new InvokeAgentCommand({
        agentId: this.config.agentId,
        agentAliasId: this.config.agentAliasId,
        sessionId: `session-${Date.now()}`,
        inputText: prompt
      });

      console.log(`🤖 Invoking Bedrock Agent: ${this.config.agentId}`);
      const response = await this.agentClient.send(command);
      
      // Process agent response
      let analysisText = '';
      if (response.completion) {
        for await (const chunk of response.completion) {
          if (chunk.chunk && chunk.chunk.bytes) {
            const text = new TextDecoder().decode(chunk.chunk.bytes);
            analysisText += text;
          }
        }
      }

      console.log('✅ Agent analysis completed');
      return {
        success: true,
        analysis: this.parseAnalysisResponse(analysisText),
        rawResponse: analysisText,
        source: 'agent',
        agentId: this.config.agentId
      };
    } catch (error) {
      console.error('Agent analysis error:', error);
      
      // In agent-only mode, don't fallback to model
      if (this.config.agentOnly) {
        throw new Error(`Agent analysis failed in agent-only mode: ${error.message}`);
      }
      
      // Fallback to direct model invocation if not in agent-only mode
      console.log('⚠️ Falling back to direct model invocation');
      return await this.analyzeWithModel(codebaseStructure, additionalContext);
    }
  }

  async analyzeWithModel(codebaseStructure, additionalContext) {
    try {
      // Check if direct model access is disabled
      if (this.config.agentOnly) {
        throw new Error('Direct model invocation is disabled in agent-only mode');
      }

      if (!this.client) {
        throw new Error('Bedrock Runtime Client is not initialized');
      }

      const prompt = this.buildAnalysisPrompt(codebaseStructure, additionalContext);
      
      const command = new InvokeModelCommand({
        modelId: this.config.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1
        })
      });

      console.log(`📝 Invoking Bedrock Model: ${this.config.modelId}`);
      const response = await this.client.send(command);
      const responseBody = JSON.parse(Buffer.from(response.body).toString());
      
      console.log('✅ Model analysis completed');
      return {
        success: true,
        analysis: this.parseAnalysisResponse(responseBody.content[0].text),
        rawResponse: responseBody.content[0].text,
        source: 'model',
        modelId: this.config.modelId
      };
    } catch (error) {
      console.error('Model analysis error:', error);
      throw error;
    }
  }

  buildAnalysisPrompt(codebaseStructure, additionalContext) {
    const { awsAnalysis, costAnalysis, iamAnalysis, computeAnalysis } = additionalContext;

    // Check if this is primarily an IaC analysis
    const hasIaCTemplates = codebaseStructure.iacTemplates && codebaseStructure.iacTemplates.length > 0;

    if (hasIaCTemplates) {
      return this.buildIaCAnalysisPrompt(codebaseStructure, additionalContext);
    }

    return `You are an expert AWS Well-Architected Framework reviewer analyzing a codebase for architectural best practices. Provide a comprehensive analysis based on the six pillars of the Well-Architected Framework.

CODEBASE STRUCTURE:
${JSON.stringify(codebaseStructure, null, 2)}

${costAnalysis ? `\nAWS COST ANALYSIS:\n${JSON.stringify(costAnalysis, null, 2)}` : ''}

${iamAnalysis ? `\nIAM SECURITY ANALYSIS:\n${JSON.stringify(iamAnalysis, null, 2)}` : ''}

${computeAnalysis ? `\nCOMPUTE RESOURCES ANALYSIS:\n${JSON.stringify(computeAnalysis, null, 2)}` : ''}

Please provide a comprehensive analysis covering:

1. **Operational Excellence**: 
   - Code organization and structure
   - Deployment practices
   - Monitoring and logging capabilities
   - Automation opportunities

2. **Security**:
   - Security best practices in code
   - IAM configurations and potential issues
   - Data protection measures
   - Network security considerations

3. **Reliability**:
   - Error handling patterns
   - Fault tolerance mechanisms
   - Backup and recovery strategies
   - Multi-region considerations

4. **Performance Efficiency**:
   - Code optimization opportunities
   - Resource utilization
   - Scalability patterns
   - Database and caching strategies

5. **Cost Optimization**:
   - Resource right-sizing opportunities
   - Cost monitoring and alerting
   - Reserved instances and savings plans
   - Unused resource identification

6. **Sustainability**:
   - Energy efficiency considerations
   - Resource optimization
   - Carbon footprint reduction opportunities

For each pillar, provide:
- Current assessment (Good/Needs Improvement/Critical)
- Specific findings
- Actionable recommendations
- Priority level (High/Medium/Low)

Format your response as JSON with the following structure:
{
  "overallAssessment": "string",
  "pillars": {
    "operationalExcellence": {
      "status": "Good|Needs Improvement|Critical",
      "findings": ["finding1", "finding2"],
      "recommendations": [
        {
          "title": "recommendation title",
          "description": "detailed description",
          "priority": "High|Medium|Low",
          "effort": "Low|Medium|High"
        }
      ]
    },
    // ... repeat for all pillars
  },
  "criticalIssues": ["issue1", "issue2"],
  "quickWins": ["win1", "win2"],
  "followUpQuestions": [
    {
      "pillar": "pillar name",
      "question": "question text",
      "context": "why this question is important",
      "relatedQuestions": ["related question keys"]
    }
  ]
}`;
  }

  buildIaCAnalysisPrompt(codebaseStructure, additionalContext) {
    const { costAnalysis, iamAnalysis, computeAnalysis } = additionalContext;
    const iacTemplates = codebaseStructure.iacTemplates || [];

    // Build template summaries for the prompt (limit content size)
    const templateSummaries = iacTemplates.map(template => ({
      path: template.path,
      type: template.type,
      fileName: template.fileName,
      size: template.size,
      // Truncate content if too large, but include key sections
      content: template.content.length > 8000 ? 
        template.content.substring(0, 8000) + '\n... [Content truncated]' : 
        template.content
    }));

    return `You are an expert AWS Well-Architected Framework reviewer specializing in Infrastructure as Code (IaC) analysis. 

You are analyzing ${iacTemplates.length} Infrastructure as Code template(s) for AWS Well-Architected Framework compliance.

INFRASTRUCTURE TEMPLATES:
${JSON.stringify(templateSummaries, null, 2)}

${costAnalysis ? `\nCURRENT AWS COST ANALYSIS:\n${JSON.stringify(costAnalysis, null, 2)}` : ''}

${iamAnalysis ? `\nCURRENT IAM SECURITY ANALYSIS:\n${JSON.stringify(iamAnalysis, null, 2)}` : ''}

${computeAnalysis ? `\nCURRENT COMPUTE RESOURCES:\n${JSON.stringify(computeAnalysis, null, 2)}` : ''}

Analyze these Infrastructure as Code templates against the AWS Well-Architected Framework's six pillars:

**1. OPERATIONAL EXCELLENCE**
- Automation and deployment practices
- Infrastructure monitoring and logging
- Change management and rollback capabilities
- Documentation and operational procedures
- Performance monitoring setup

**2. SECURITY**
- IAM roles, policies, and permissions
- Encryption at rest and in transit
- Network security (VPCs, Security Groups, NACLs)
- Secrets management
- Access logging and auditing
- Compliance with security best practices

**3. RELIABILITY**
- Multi-AZ and cross-region deployments
- Auto-scaling configurations
- Backup and disaster recovery
- Health checks and monitoring
- Fault tolerance and redundancy
- Error handling and retries

**4. PERFORMANCE EFFICIENCY**
- Resource sizing and instance types
- Storage performance configurations
- Network optimization
- Caching strategies
- Database performance settings
- Compute resource allocation

**5. COST OPTIMIZATION**
- Resource rightsizing
- Reserved instances and savings plans usage
- Storage class optimization
- Lifecycle policies
- Unused resource identification
- Cost monitoring and budgeting

**6. SUSTAINABILITY**
- Resource efficiency
- Carbon footprint considerations
- Serverless and managed service usage
- Resource lifecycle management
- Green computing practices

For each template, identify:
- Resource types and configurations
- Security misconfigurations
- Cost optimization opportunities
- Performance bottlenecks
- Reliability issues
- Operational challenges

Provide specific, actionable recommendations with:
- Exact resource names/paths where issues exist
- Code snippets showing current vs. recommended configurations
- Priority levels (Critical/High/Medium/Low)
- Estimated impact on cost, security, and performance

Please provide your analysis in the following JSON format:

{
  "overallAssessment": "Overall assessment of the infrastructure templates",
  "templatesAnalyzed": ${iacTemplates.length},
  "templateTypes": [${iacTemplates.map(t => `"${t.type}"`).join(', ')}],
  "pillars": {
    "operationalExcellence": {
      "status": "Good|Needs Improvement|Critical",
      "score": 1-5,
      "findings": ["specific finding with resource name"],
      "recommendations": [
        {
          "title": "recommendation title",
          "description": "actionable recommendation with code example",
          "priority": "Critical|High|Medium|Low",
          "effort": "Low|Medium|High",
          "resourcePath": "path/to/template.yaml",
          "resourceName": "specific resource name"
        }
      ]
    },
    "security": {
      "status": "Good|Needs Improvement|Critical",
      "score": 1-5,
      "findings": ["specific security finding with resource name"],
      "recommendations": [
        {
          "title": "security recommendation title",
          "description": "security recommendation with code example",
          "priority": "Critical|High|Medium|Low",
          "effort": "Low|Medium|High",
          "resourcePath": "path/to/template.yaml",
          "resourceName": "specific resource name",
          "securityImpact": "High|Medium|Low"
        }
      ]
    },
    "reliability": {
      "status": "Good|Needs Improvement|Critical",
      "score": 1-5,
      "findings": ["reliability finding with resource name"],
      "recommendations": [
        {
          "title": "reliability recommendation title",
          "description": "reliability recommendation",
          "priority": "Critical|High|Medium|Low",
          "effort": "Low|Medium|High",
          "resourcePath": "path/to/template.yaml"
        }
      ]
    },
    "performanceEfficiency": {
      "status": "Good|Needs Improvement|Critical", 
      "score": 1-5,
      "findings": ["performance finding with resource name"],
      "recommendations": [
        {
          "title": "performance recommendation title",
          "description": "performance optimization recommendation",
          "priority": "Critical|High|Medium|Low",
          "effort": "Low|Medium|High",
          "resourcePath": "path/to/template.yaml"
        }
      ]
    },
    "costOptimization": {
      "status": "Good|Needs Improvement|Critical",
      "score": 1-5,
      "findings": ["cost finding with resource name"],
      "recommendations": [
        {
          "title": "cost optimization title",
          "description": "cost optimization recommendation",
          "priority": "Critical|High|Medium|Low",
          "effort": "Low|Medium|High",
          "estimatedSavings": "potential monthly savings estimate",
          "resourcePath": "path/to/template.yaml"
        }
      ]
    },
    "sustainability": {
      "status": "Good|Needs Improvement|Critical",
      "score": 1-5,
      "findings": ["sustainability finding"],
      "recommendations": [
        {
          "title": "sustainability recommendation title",
          "description": "sustainability recommendation",
          "priority": "Medium|Low",
          "effort": "Low|Medium|High"
        }
      ]
    }
  },
  "overallScore": 1-5,
  "criticalIssues": ["cross-pillar critical issues with resource names"],
  "quickWins": ["easy-to-implement improvements with specific resources"],
  "resourceInventory": {
    "compute": ["EC2, Lambda, ECS, etc. with counts"],
    "storage": ["S3, EBS, EFS, etc. with counts"],
    "database": ["RDS, DynamoDB, etc. with counts"],
    "networking": ["VPC, ALB, CloudFront, etc. with counts"],
    "security": ["IAM, KMS, Secrets Manager, etc. with counts"]
  },
  "followUpQuestions": [
    {
      "pillar": "pillar name",
      "question": "specific question about the infrastructure",
      "context": "why this question is important for this infrastructure",
      "relatedResources": ["resource names this question relates to"]
    }
  ]
}`;
  }

  parseAnalysisResponse(responseText) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Fallback: create structured response from text
      return this.createFallbackAnalysis(responseText);
    } catch (error) {
      console.error('Error parsing Bedrock response:', error);
      return this.createFallbackAnalysis(responseText);
    }
  }

  createFallbackAnalysis(responseText) {
    return {
      overallAssessment: "Analysis completed - please review the detailed findings below",
      pillars: {
        operationalExcellence: {
          status: "Needs Improvement",
          findings: ["Automated analysis completed"],
          recommendations: [
            {
              title: "Review Analysis Results",
              description: responseText,
              priority: "Medium",
              effort: "Medium"
            }
          ]
        }
      },
      criticalIssues: [],
      quickWins: [],
      followUpQuestions: []
    };
  }

  async generateFollowUpQuestions(analysisResult, userAnswers = {}) {
    try {
      const prompt = `Based on the following Well-Architected analysis and user answers, generate relevant follow-up questions to gather more specific information.

ANALYSIS RESULT:
${JSON.stringify(analysisResult, null, 2)}

USER ANSWERS:
${JSON.stringify(userAnswers, null, 2)}

Generate 3-5 follow-up questions that would help clarify implementation details, gather missing information, or dive deeper into specific areas that need attention.

Format as JSON:
{
  "questions": [
    {
      "id": "unique_question_id",
      "pillar": "pillar name",
      "question": "question text",
      "context": "why this question is important",
      "answerType": "text|multiple_choice|yes_no",
      "options": ["option1", "option2"] // only for multiple_choice
    }
  ]
}`;

      // Use agent if available, otherwise use model
      if (this.config.agentId && this.agentClient) {
        const command = new InvokeAgentCommand({
          agentId: this.config.agentId,
          agentAliasId: this.config.agentAliasId,
          sessionId: `followup-${Date.now()}`,
          inputText: prompt
        });

        const response = await this.agentClient.send(command);
        
        let responseText = '';
        if (response.completion) {
          for await (const chunk of response.completion) {
            if (chunk.chunk && chunk.chunk.bytes) {
              responseText += new TextDecoder().decode(chunk.chunk.bytes);
            }
          }
        }

        try {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        } catch (error) {
          console.error('Error parsing follow-up questions:', error);
        }
      } else if (!this.config.agentOnly && this.client) {
        const command = new InvokeModelCommand({
          modelId: this.config.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2000,
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3
          })
        });

        const response = await this.client.send(command);
        const responseBody = JSON.parse(Buffer.from(response.body).toString());
        
        try {
          const jsonMatch = responseBody.content[0].text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        } catch (error) {
          console.error('Error parsing follow-up questions:', error);
        }
      }

      return { questions: [] };
    } catch (error) {
      console.error('Error generating follow-up questions:', error);
      return { questions: [] };
    }
  }

  async generateRecommendations(answers, analysisResult) {
    try {
      const prompt = `Based on the user's answers to Well-Architected questions and the initial analysis, provide specific, actionable recommendations.

USER ANSWERS:
${JSON.stringify(answers, null, 2)}

INITIAL ANALYSIS:
${JSON.stringify(analysisResult, null, 2)}

Provide detailed recommendations for improvement, including:
- Specific implementation steps
- Estimated effort and timeline
- Expected benefits
- Risk considerations
- Dependencies

Format as JSON:
{
  "recommendations": [
    {
      "id": "unique_id",
      "pillar": "pillar name",
      "title": "recommendation title",
      "description": "detailed description",
      "implementationSteps": ["step1", "step2"],
      "priority": "High|Medium|Low",
      "effort": "Low|Medium|High",
      "timeline": "estimated timeline",
      "benefits": ["benefit1", "benefit2"],
      "risks": ["risk1", "risk2"],
      "dependencies": ["dependency1", "dependency2"]
    }
  ]
}`;

      // Use agent if available, otherwise use model
      if (this.config.agentId && this.agentClient) {
        const command = new InvokeAgentCommand({
          agentId: this.config.agentId,
          agentAliasId: this.config.agentAliasId,
          sessionId: `recommendations-${Date.now()}`,
          inputText: prompt
        });

        const response = await this.agentClient.send(command);
        
        let responseText = '';
        if (response.completion) {
          for await (const chunk of response.completion) {
            if (chunk.chunk && chunk.chunk.bytes) {
              responseText += new TextDecoder().decode(chunk.chunk.bytes);
            }
          }
        }

        try {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        } catch (error) {
          console.error('Error parsing recommendations:', error);
        }
      } else if (!this.config.agentOnly && this.client) {
        const command = new InvokeModelCommand({
          modelId: this.config.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 3000,
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.2
          })
        });

        const response = await this.client.send(command);
        const responseBody = JSON.parse(Buffer.from(response.body).toString());
        
        try {
          const jsonMatch = responseBody.content[0].text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        } catch (error) {
          console.error('Error parsing recommendations:', error);
        }
      }

      return { recommendations: [] };
    } catch (error) {
      console.error('Error generating recommendations:', error);
      return { recommendations: [] };
    }
  }

  async testConnection() {
    try {
      // Test agent connection if available
      if (this.config.agentId && this.agentClient) {
        const command = new InvokeAgentCommand({
          agentId: this.config.agentId,
          agentAliasId: this.config.agentAliasId,
          sessionId: `test-${Date.now()}`,
          inputText: 'Hello, please respond with "Bedrock Agent connection successful"'
        });

        await this.agentClient.send(command);
        return { 
          success: true, 
          message: 'Bedrock Agent connection successful',
          mode: 'agent',
          agentId: this.config.agentId
        };
      }

      // Test model connection if not in agent-only mode
      if (!this.config.agentOnly && this.client) {
        const command = new InvokeModelCommand({
          modelId: this.config.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 100,
            messages: [
              {
                role: 'user',
                content: 'Hello, please respond with "Bedrock connection successful"'
              }
            ]
          })
        });

        await this.client.send(command);
        return { 
          success: true, 
          message: 'Bedrock model connection successful',
          mode: 'model',
          modelId: this.config.modelId
        };
      }

      return { 
        success: false, 
        error: 'No valid Bedrock configuration found' 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  async analyzeText(prompt) {
    try {
      // First try with agent if available
      if (this.config.agentId && this.agentClient) {
        try {
          const command = new InvokeAgentCommand({
            agentId: this.config.agentId,
            agentAliasId: this.config.agentAliasId,
            sessionId: `text-analysis-${Date.now()}`,
            inputText: prompt
          });

          const response = await this.agentClient.send(command);
          let fullResponse = '';
          
          for await (const event of response.completion) {
            if (event.chunk?.bytes) {
              const chunk = JSON.parse(Buffer.from(event.chunk.bytes).toString());
              if (chunk.type === 'chunk') {
                fullResponse += chunk.bytes ? Buffer.from(chunk.bytes, 'base64').toString() : '';
              }
            }
          }

          return {
            success: true,
            analysis: fullResponse,
            source: 'agent'
          };
        } catch (agentError) {
          console.warn('Agent text analysis failed, falling back to model:', agentError.message);
          
          if (this.config.agentOnly) {
            throw new Error(`Agent text analysis failed: ${agentError.message}`);
          }
        }
      }

      // Fallback to direct model if agent fails or not available
      if (this.config.agentOnly) {
        throw new Error('Direct model invocation is disabled in agent-only mode');
      }

      const command = new InvokeModelCommand({
        modelId: this.config.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1
        })
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(Buffer.from(response.body).toString());
      
      return {
        success: true,
        analysis: responseBody.content[0].text,
        source: 'model'
      };

    } catch (error) {
      console.error('Text analysis error:', error);
      throw error;
    }
  }

  async analyzeAWSDataForWellArchitected(awsData) {
    try {
      console.log('🤖 Analyzing AWS data with Bedrock Agent for Well-Architected questions');

      const prompt = `You are an expert AWS Well-Architected Framework reviewer. Analyze the following comprehensive AWS data and automatically answer as many Well-Architected Framework questions as possible based on the available data.

AWS ANALYSIS DATA:
${JSON.stringify(awsData, null, 2)}

Your task:
1. Review the AWS data (Trusted Advisor, Cost Explorer, IAM, EC2, CloudWatch, Config)
2. Automatically answer Well-Architected Framework questions where you have sufficient data
3. For each auto-answered question, provide the answer and confidence score (0.0-1.0)
4. Identify questions that require user input because the data is insufficient

Please respond in the following JSON format:
{
  "autoAnswers": [
    {
      "questionKey": "SEC01",
      "pillar": "Security", 
      "answer": "Based on the IAM analysis, MFA is enabled for 80% of users...",
      "confidence": 0.85,
      "dataSource": "IAM Analysis - Credential Report"
    }
  ],
  "autoAnsweredQuestions": 15,
  "questionsNeedingUserInput": [
    {
      "questionKey": "OPS01",
      "reason": "Requires organizational context not available in AWS data"
    }
  ],
  "summary": "Automatically answered 15 questions based on AWS data analysis. Remaining questions require organizational and procedural context."
}`;

      const response = await this.analyzeText(prompt);
      
      if (response.success) {
        try {
          const jsonMatch = response.analysis.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        } catch (error) {
          console.error('Error parsing agent response:', error);
        }
      }

      // Fallback response
      return {
        autoAnswers: [],
        autoAnsweredQuestions: 0,
        questionsNeedingUserInput: [],
        summary: 'Unable to automatically answer questions. Manual review required.'
      };

    } catch (error) {
      console.error('Error analyzing AWS data for Well-Architected questions:', error);
      throw error;
    }
  }

  async analyzeUserAnswer(userAnswer, questionKey, sessionId) {
    try {
      console.log(`🤖 Analyzing user answer for question ${questionKey}`);

      const prompt = `You are an expert AWS Well-Architected Framework reviewer. A user has provided an answer to a Well-Architected question. Analyze this answer and determine if it can also answer other related questions.

USER ANSWER: "${userAnswer}"
QUESTION KEY: ${questionKey}

Your task:
1. Analyze the user's answer for completeness and relevance
2. Identify other Well-Architected questions that this answer might also address
3. Generate derived answers for those related questions
4. Provide confidence scores for each derived answer

Please respond in JSON format:
{
  "primaryAnswer": {
    "questionKey": "${questionKey}",
    "analysis": "Analysis of the primary answer quality and completeness",
    "confidence": 0.9
  },
  "additionalAnswers": [
    {
      "questionKey": "REL02",
      "answer": "Derived answer based on user's response...",
      "confidence": 0.75,
      "reasoning": "User mentioned network topology which relates to this reliability question"
    }
  ],
  "suggestions": [
    "Consider elaborating on backup strategies",
    "Mention specific monitoring tools used"
  ]
}`;

      const response = await this.analyzeText(prompt);
      
      if (response.success) {
        try {
          const jsonMatch = response.analysis.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        } catch (error) {
          console.error('Error parsing user answer analysis:', error);
        }
      }

      // Fallback response
      return {
        primaryAnswer: {
          questionKey,
          analysis: 'Answer recorded',
          confidence: 0.8
        },
        additionalAnswers: [],
        suggestions: []
      };

    } catch (error) {
      console.error('Error analyzing user answer:', error);
      throw error;
    }
  }

  async generateWellArchitectedReport(answers, awsData) {
    try {
      console.log('📊 Generating comprehensive Well-Architected Framework report');

      const prompt = `You are an expert AWS Well-Architected Framework reviewer. Generate a comprehensive Well-Architected Framework report based on the provided answers and AWS analysis data.

ANSWERS TO WELL-ARCHITECTED QUESTIONS:
${JSON.stringify(answers, null, 2)}

AWS ANALYSIS DATA:
${JSON.stringify(awsData, null, 2)}

Generate a comprehensive report with:
1. Overall Well-Architected maturity score (1-5)
2. Detailed analysis for each of the 6 pillars
3. Specific recommendations with priority levels
4. Action plan with timelines
5. Risk assessment
6. Cost impact analysis

Please respond in JSON format:
{
  "overallScore": 3.8,
  "maturityLevel": "Intermediate",
  "pillars": {
    "operationalExcellence": {
      "score": 4.2,
      "status": "Good",
      "strengths": ["Automated deployments", "Comprehensive monitoring"],
      "weaknesses": ["Limited runbook documentation"],
      "recommendations": [
        {
          "title": "Improve Runbook Documentation",
          "description": "Create comprehensive operational runbooks",
          "priority": "Medium",
          "effort": "2-4 weeks",
          "impact": "High"
        }
      ]
    },
    "security": {
      "score": 3.5,
      "status": "Needs Improvement",
      "strengths": ["MFA enabled", "IAM roles implemented"],
      "weaknesses": ["Some unencrypted resources", "Missing security monitoring"],
      "recommendations": [
        {
          "title": "Enable Encryption at Rest",
          "description": "Encrypt all storage resources",
          "priority": "High",
          "effort": "1-2 weeks",
          "impact": "High"
        }
      ]
    }
  },
  "criticalIssues": [
    "Unencrypted EBS volumes identified",
    "Missing backup strategy for critical databases"
  ],
  "quickWins": [
    "Enable MFA for remaining users",
    "Set up billing alerts"
  ],
  "actionPlan": {
    "immediate": ["Enable encryption", "Set up monitoring"],
    "shortTerm": ["Implement backup strategy", "Update documentation"],
    "longTerm": ["Multi-region deployment", "Advanced security controls"]
  },
  "estimatedCostImpact": {
    "savings": "$2,400/month",
    "investments": "$1,200/month",
    "netBenefit": "$1,200/month"
  }
}`;

      const response = await this.analyzeText(prompt);
      
      if (response.success) {
        try {
          const jsonMatch = response.analysis.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        } catch (error) {
          console.error('Error parsing Well-Architected report:', error);
        }
      }

      // Fallback response
      return {
        overallScore: 3.0,
        maturityLevel: "Developing",
        pillars: {},
        criticalIssues: [],
        quickWins: [],
        actionPlan: { immediate: [], shortTerm: [], longTerm: [] },
        estimatedCostImpact: { savings: "TBD", investments: "TBD", netBenefit: "TBD" }
      };

    } catch (error) {
      console.error('Error generating Well-Architected report:', error);
      throw error;
    }
  }

  getConfiguration() {
    return {
      modelId: this.config?.modelId,
      agentId: this.config?.agentId,
      agentAliasId: this.config?.agentAliasId,
      agentEnabled: !!this.config?.agentId,
      agentOnly: this.config?.agentOnly || false,
      region: this.config?.region,
      mode: this.config?.agentOnly ? 'agent-only' : 
            (this.config?.agentId ? 'hybrid' : 'model-only')
    };
  }
} 