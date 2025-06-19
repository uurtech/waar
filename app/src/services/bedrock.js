import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export class BedrockService {
  constructor(awsService) {
    this.awsService = awsService;
    this.client = null;
    this.modelId = 'anthropic.claude-3-sonnet-20240229-v1:0';
  }

  async initialize() {
    try {
      this.client = new BedrockRuntimeClient({
        region: this.awsService.region,
        credentials: this.awsService.credentials
      });

      console.log('✅ Bedrock service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Bedrock service:', error);
      throw error;
    }
  }

  async analyzeCodebase(codebaseStructure, additionalContext = {}) {
    try {
      const prompt = this.buildAnalysisPrompt(codebaseStructure, additionalContext);
      
      const command = new InvokeModelCommand({
        modelId: this.modelId,
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

      const response = await this.client.send(command);
      const responseBody = JSON.parse(Buffer.from(response.body).toString());
      
      return {
        success: true,
        analysis: this.parseAnalysisResponse(responseBody.content[0].text),
        rawResponse: responseBody.content[0].text
      };
    } catch (error) {
      console.error('Bedrock analysis error:', error);
      return {
        success: false,
        error: error.message,
        analysis: null
      };
    }
  }

  buildAnalysisPrompt(codebaseStructure, additionalContext) {
    const { awsAnalysis, costAnalysis, iamAnalysis, computeAnalysis } = additionalContext;

    return `You are an expert AWS Well-Architected Framework reviewer. Analyze the following codebase structure and AWS infrastructure data to provide insights based on the six pillars of the Well-Architected Framework.

CODEBASE STRUCTURE:
${JSON.stringify(codebaseStructure, null, 2)}

${awsAnalysis ? `\nAWS COST ANALYSIS:\n${JSON.stringify(costAnalysis, null, 2)}` : ''}

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

      const command = new InvokeModelCommand({
        modelId: this.modelId,
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

      const command = new InvokeModelCommand({
        modelId: this.modelId,
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

      return { recommendations: [] };
    } catch (error) {
      console.error('Error generating recommendations:', error);
      return { recommendations: [] };
    }
  }

  async testConnection() {
    try {
      const command = new InvokeModelCommand({
        modelId: this.modelId,
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
      return { success: true, message: 'Bedrock connection successful' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
} 