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