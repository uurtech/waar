# Docker Compose Setup Guide

Simple Docker Compose setup for the AWS Well-Architected Review application using a single container with embedded SQLite database.

## 🚀 Quick Start

### 1. Prerequisites
- Docker and Docker Compose installed
- AWS credentials with appropriate permissions
- Bedrock Agent ID (recommended)

### 2. Configuration

Copy the example environment file and configure your settings:
```bash
cp env.example .env
```

Edit `.env` with your AWS credentials and Bedrock configuration:
```bash
# Required AWS Credentials
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_DEFAULT_REGION=us-east-1

# Required Bedrock Configuration
BEDROCK_AGENT_ID=your_bedrock_agent_id
BEDROCK_AGENT_ONLY=true
```

### 3. Run the Application

#### Simple Start (Production)
```bash
# Create required directories
mkdir -p data logs

# Build and start the application
docker-compose up --build -d

# View logs
docker-compose logs -f
```

#### Development Mode
```bash
# Start with development overrides (automatic)
docker-compose up --build

# Or explicitly use override file
docker-compose -f docker-compose.yml -f docker-compose.override.yml up --build
```

#### Access the Application
Open your browser and navigate to: `http://localhost:8080`

## 📋 Architecture

### Single Container Design
- **Node.js Application**: Runs with `npm start`
- **SQLite Database**: Embedded in the application (no separate database container)
- **Static Files**: Served directly by Express
- **Health Checks**: Built-in endpoint monitoring

### File Structure
```
├── docker-compose.yml           # Main production configuration
├── docker-compose.override.yml  # Development overrides (auto-loaded)
├── .env                         # Environment variables
├── data/                        # SQLite database storage (persistent)
├── logs/                        # Application logs (persistent)
└── app/                         # Application source code
```

## 🛠️ Common Commands

### Start Services
```bash
# Production mode (detached)
docker-compose up -d

# Development mode (with logs)
docker-compose up

# Force rebuild
docker-compose up --build
```

### Stop Services
```bash
# Stop the application
docker-compose down

# Stop and remove volumes (careful - deletes data!)
docker-compose down -v
```

### View Logs
```bash
# Follow logs
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100

# Show timestamps
docker-compose logs -f -t
```

### Development Commands
```bash
# Shell into container
docker-compose exec well-architected-reviewer /bin/bash

# Install new npm packages
docker-compose exec well-architected-reviewer npm install package-name

# Run npm commands
docker-compose exec well-architected-reviewer npm run build
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key | - | ✅ |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Key | - | ✅ |
| `AWS_DEFAULT_REGION` | AWS Region | `us-east-1` | ✅ |
| `AWS_SESSION_TOKEN` | Session Token | - | ⚠️ (temp credentials) |
| `BEDROCK_AGENT_ID` | Bedrock Agent ID | - | ✅ |
| `BEDROCK_AGENT_ALIAS_ID` | Agent Alias | `TSTALIASID` | ❌ |
| `BEDROCK_AGENT_ONLY` | Agent-only mode | `true` | ❌ |
| `NODE_ENV` | Environment | `production` | ❌ |
| `LOG_LEVEL` | Logging level | `info` | ❌ |

### Volume Mounts

#### Production Mode
```yaml
volumes:
  - ./data:/var/app/data    # SQLite database
  - ./logs:/var/app/logs    # Application logs
```

#### Development Mode (with override)
```yaml
volumes:
  - ./app:/var/app          # Source code (live reload)
  - ./data:/var/app/data    # SQLite database
  - ./logs:/var/app/logs    # Application logs
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Permission Denied Errors
```bash
# Fix volume permissions
sudo chown -R $USER:$USER data logs
chmod 755 data logs
```

#### 2. Port Already in Use
```bash
# Check what's using port 8080
lsof -i :8080

# Kill the process or change port in docker-compose.yml
```

#### 3. AWS Credentials Not Working
```bash
# Test AWS credentials
docker-compose exec well-architected-reviewer aws sts get-caller-identity

# Check environment variables
docker-compose exec well-architected-reviewer env | grep AWS
```

#### 4. Database Issues
```bash
# Check SQLite database
docker-compose exec well-architected-reviewer ls -la /var/app/data/

# Reset database (removes all data!)
rm -rf data/well_architected.db
docker-compose restart
```

#### 5. Application Won't Start
```bash
# Check container status
docker-compose ps

# View detailed logs
docker-compose logs well-architected-reviewer

# Check health status
curl http://localhost:8080/api/health
```

### Health Checks

The application includes built-in health checks:

```bash
# Check application health
curl http://localhost:8080/api/health

# Check AWS connectivity
curl http://localhost:8080/api/health/aws

# Check Bedrock connectivity
curl http://localhost:8080/api/health/bedrock
```

## 🔐 Security Considerations

### Production Deployment

1. **Environment Variables**: Use `.env` file for sensitive data
2. **File Permissions**: Ensure data directory has proper permissions
3. **Network Security**: Application runs on localhost by default
4. **Database Security**: SQLite file is stored in mounted volume

### Example Production `.env`
```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-1
BEDROCK_AGENT_ID=...
BEDROCK_AGENT_ONLY=true
NODE_ENV=production
LOG_LEVEL=info
```

## 📈 Monitoring and Logging

### Log Files
```bash
# Application logs
tail -f logs/combined.log

# Error logs only
tail -f logs/error.log

# Docker logs
docker-compose logs -f
```

### Monitoring
```bash
# Resource usage
docker stats well-architected-reviewer

# Container health
docker-compose ps
```

## 🔄 Updates and Maintenance

### Update Application
```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose up --build -d

# Clean up old images
docker image prune
```

### Backup Data
```bash
# Backup SQLite database
cp data/well_architected.db backup_$(date +%Y%m%d).db

# Backup with Docker
docker-compose exec well-architected-reviewer cp /var/app/data/well_architected.db /var/app/logs/backup.db
```

### Reset Application
```bash
# Stop application
docker-compose down

# Remove data (careful!)
rm -rf data logs

# Create fresh directories
mkdir -p data logs

# Start fresh
docker-compose up --build
```

---

## 📞 Support

For issues with Docker Compose setup:
1. Check the troubleshooting section above
2. Verify your `.env` file configuration
3. Review Docker logs with `docker-compose logs`
4. Test health endpoints
5. Open an issue on GitHub with relevant logs 