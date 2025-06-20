# AWS Well-Architected Framework Reviewer

🚀 **AI-powered AWS assessment using Trusted Advisor, AWS APIs, and Amazon Bedrock Agent**

An intelligent application that analyzes your live AWS environment and provides comprehensive Well-Architected Framework assessments with AI-powered recommendations and interactive Q&A.

## ✨ Key Features

### 🤖 AI-Powered AWS Analysis
- **Bedrock Agent Integration**: Uses Claude 3 Sonnet for intelligent analysis and recommendations
- **Automatic Question Answering**: AI automatically answers Well-Architected questions based on your AWS data
- **Smart Answer Mapping**: Single user responses can automatically answer multiple related questions
- **Interactive Q&A**: Guided assessment for questions requiring organizational context

### 🔍 Comprehensive AWS Data Analysis
- **🛡️ Trusted Advisor**: Security, cost, performance, and fault tolerance checks
- **💰 Cost Explorer**: Cost optimization and rightsizing recommendations  
- **👥 IAM Analysis**: Identity and access management security assessment
- **🖥️ EC2 & Compute**: Resource utilization and optimization insights
- **📊 CloudWatch**: Performance metrics and monitoring analysis
- **⚖️ Config**: Compliance and configuration assessment

### 🏛️ Well-Architected Framework Coverage
Complete evaluation across all six pillars:
- **🏗️ Operational Excellence** - Operations, monitoring, incident response
- **🔒 Security** - Identity management, data protection, infrastructure security
- **🛡️ Reliability** - Fault tolerance, backup/recovery, scaling strategies  
- **⚡ Performance Efficiency** - Resource optimization, monitoring, architecture
- **💰 Cost Optimization** - Right-sizing, cost monitoring, resource efficiency
- **🌱 Sustainability** - Resource efficiency, carbon footprint optimization

### 📊 Advanced Reporting
- **Overall Maturity Score**: 1-5 scale assessment with detailed breakdown
- **Pillar-Specific Scores**: Individual scores and status for each pillar
- **Prioritized Recommendations**: High/Medium/Low priority with effort estimates
- **Cost Impact Analysis**: Estimated savings and investment requirements
- **Action Plans**: Immediate, short-term, and long-term implementation roadmaps

## 🚀 Quick Start

### 1. Prerequisites

#### AWS Setup
- **AWS Account** with appropriate permissions
- **AWS Bedrock Access** - Enable Claude 3 Sonnet model in your region
- **Trusted Advisor Access** - Business or Enterprise support plan recommended
- **AWS Credentials** configured

#### Required AWS Permissions
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock-agent-runtime:InvokeAgent",
        "support:DescribeTrustedAdvisorChecks",
        "support:DescribeTrustedAdvisorCheckResult",
        "ce:GetDimensionValues",
        "ce:GetRightsizingRecommendation",
        "ce:GetCostAndUsage",
        "iam:GenerateCredentialReport",
        "iam:GetCredentialReport",
        "iam:ListUsers",
        "iam:ListRoles",
        "iam:ListPolicies",
        "ec2:DescribeInstances",
        "ec2:DescribeVolumes", 
        "ec2:DescribeSecurityGroups",
        "cloudwatch:GetMetricStatistics",
        "cloudtrail:LookupEvents",
        "config:DescribeConfigRules",
        "config:GetComplianceDetailsByConfigRule"
      ],
      "Resource": "*"
    }
  ]
}
```

### 2. Configuration

#### Environment Variables (Recommended)
```bash
# AWS Credentials
export AWS_ACCESS_KEY_ID=your_access_key_id
export AWS_SECRET_ACCESS_KEY=your_secret_access_key  
export AWS_DEFAULT_REGION=us-east-1
export AWS_SESSION_TOKEN=your_session_token  # If using temporary credentials

# Bedrock Configuration
export BEDROCK_AGENT_ID=your_bedrock_agent_id
export BEDROCK_AGENT_ALIAS_ID=TSTALIASID
export BEDROCK_AGENT_ONLY=true  # Recommended for best results
```

### 3. Run with Docker

```bash
# Run Well-Architected Review Tool
docker run -p 8080:8080 \
  -e AWS_ACCESS_KEY_ID=your_access_key_id \
  -e AWS_SECRET_ACCESS_KEY=your_secret_access_key \
  -e AWS_DEFAULT_REGION=us-east-1 \
  -e BEDROCK_AGENT_ID=your_bedrock_agent_id \
  -e BEDROCK_AGENT_ONLY=true \
  well-architected-reviewer
```

### 4. Access the Application

Open your browser and navigate to: `http://localhost:8080`

Click **"Start Well-Architected Review"** to begin your assessment.

## 🎯 How It Works

### 1. **AWS Environment Analysis** (30-60 seconds)
The application automatically analyzes your AWS environment using:
- Trusted Advisor checks across all categories
- Cost Explorer data for optimization opportunities
- IAM configuration and security analysis
- EC2 instances, volumes, and security groups
- CloudWatch performance metrics
- AWS Config compliance rules

### 2. **AI Auto-Answering**
Bedrock Agent analyzes your AWS data and automatically answers Well-Architected questions where sufficient data exists, such as:
- Security configurations and MFA status
- Cost optimization opportunities
- Performance metrics and utilization
- Backup and monitoring configurations
- Compliance and governance settings

### 3. **Interactive Q&A**
For questions requiring organizational context, the application presents them one at a time:
- Clear, well-structured questions
- Context-aware follow-ups
- AI analysis of answers to identify related questions
- Progress tracking throughout the assessment

### 4. **Comprehensive Report Generation**
Final report includes:
- Overall Well-Architected maturity score
- Detailed pillar-by-pillar analysis
- Prioritized recommendations with implementation guidance
- Cost impact estimates
- Action plans with timelines

## 📋 API Reference

### Start New Review
```bash
POST /api/review/start
```
Initiates comprehensive AWS analysis and Well-Architected review session.

### Submit Answer
```bash
POST /api/review/{sessionId}/answer
{
  "questionKey": "SEC01",
  "answer": "We implement MFA for all users..."
}
```

### Get Review Status
```bash
GET /api/review/{sessionId}/status
```
Returns current progress and next question.

### Get Final Report
```bash
GET /api/review/{sessionId}/report
```
Returns comprehensive Well-Architected assessment report.

### Get AWS Analysis (Debug)
```bash
GET /api/review/aws-analysis
```
Returns raw AWS analysis data for debugging.

## 🏗️ Architecture

### Application Components
- **Express.js Backend**: RESTful API with AWS SDK integrations
- **SQLite Database**: Stores questions, answers, and session data
- **Modern Frontend**: Responsive UI with real-time progress tracking
- **AWS Service Integrations**: Direct API calls to AWS services
- **Bedrock Agent**: AI-powered analysis and recommendation engine

### Data Flow
1. **AWS APIs** → Comprehensive environment analysis
2. **Bedrock Agent** → AI analysis and auto-answering
3. **Interactive UI** → User input for organizational questions
4. **Database** → Session and answer persistence
5. **Report Generation** → Final Well-Architected assessment

## 🔧 Development

### Local Development Setup
```bash
# Clone repository
git clone <repository-url>
cd well-architected-reviewer

# Install dependencies
cd app && npm install

# Set environment variables
cp .env.example .env
# Edit .env with your AWS credentials and Bedrock configuration

# Run development server
npm run dev
```

### Build Docker Image
```bash
docker build -t well-architected-reviewer .
```

## 🛠️ Troubleshooting

### Common Issues

#### "The security token included in the request is invalid"
- **Cause**: Expired or invalid AWS credentials
- **Solution**: Refresh your AWS credentials or check IAM permissions

#### "Access Denied" for Trusted Advisor
- **Cause**: Insufficient support plan or missing permissions
- **Solution**: Upgrade to Business/Enterprise support or add required IAM permissions

#### Bedrock Agent not responding
- **Cause**: Agent not configured or incorrect Agent ID
- **Solution**: Verify Agent ID and ensure Bedrock Agent is properly set up

#### No questions auto-answered
- **Cause**: Limited AWS data or Agent analysis issues
- **Solution**: Check AWS service permissions and Agent configuration

### Debug Mode
Enable detailed logging by setting:
```bash
export DEBUG=true
export LOG_LEVEL=debug
```

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:
- Check the troubleshooting section
- Review AWS service permissions
- Verify Bedrock Agent configuration
- Open an issue on GitHub

---

**Built with ❤️ for AWS Well-Architected Framework assessments** 