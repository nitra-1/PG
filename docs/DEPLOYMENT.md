# Deployment Guide

## Overview

This guide covers deployment options for the Payment Gateway system.

## Docker Deployment

### Prerequisites
- Docker installed
- Docker Compose installed

### Steps

1. **Build the Docker image**
   ```bash
   docker build -t payment-gateway:latest .
   ```

2. **Run with Docker Compose**
   ```bash
   docker-compose up -d
   ```

3. **Check logs**
   ```bash
   docker-compose logs -f app
   ```

4. **Stop services**
   ```bash
   docker-compose down
   ```

## Kubernetes Deployment

### Prerequisites
- Kubernetes cluster (v1.20+)
- kubectl configured
- Helm (optional)

### Configuration Files

Create Kubernetes manifests in `deployment/kubernetes/`:

1. **Deployment** (`deployment.yaml`)
2. **Service** (`service.yaml`)
3. **ConfigMap** (`configmap.yaml`)
4. **Secret** (`secret.yaml`)
5. **Ingress** (`ingress.yaml`)

### Deploy to Kubernetes

```bash
# Create namespace
kubectl create namespace payment-gateway

# Apply configurations
kubectl apply -f deployment/kubernetes/ -n payment-gateway

# Check deployment
kubectl get pods -n payment-gateway
kubectl get services -n payment-gateway

# Check logs
kubectl logs -f deployment/payment-gateway -n payment-gateway
```

## Cloud Deployment

### AWS

#### Elastic Beanstalk
1. Install EB CLI
2. Initialize: `eb init`
3. Create environment: `eb create production`
4. Deploy: `eb deploy`

#### ECS/Fargate
1. Push Docker image to ECR
2. Create task definition
3. Create ECS service
4. Configure load balancer

### Azure

#### App Service
1. Create App Service
2. Configure deployment from GitHub
3. Set environment variables
4. Deploy application

### Google Cloud Platform

#### Cloud Run
```bash
gcloud run deploy payment-gateway \
  --image gcr.io/PROJECT_ID/payment-gateway \
  --platform managed \
  --region us-central1
```

## Environment Variables

Required environment variables for production:

```env
NODE_ENV=production
PORT=3000

# Database
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=payment_gateway
DB_USER=your-db-user
DB_PASSWORD=your-secure-password

# Redis
REDIS_HOST=your-redis-host
REDIS_PORT=6379

# Security
ENCRYPTION_KEY=your-encryption-key
HMAC_SECRET=your-hmac-secret
JWT_SECRET=your-jwt-secret

# Payment Gateways
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret

# Features
FEATURE_UPI=true
FEATURE_BNPL=true
FEATURE_EMI=true
```

## Monitoring Setup

### Prometheus

1. Deploy Prometheus
2. Configure scraping for `/metrics` endpoint
3. Set up alerting rules

### Logging

1. Configure log aggregation (ELK/Splunk)
2. Set up log retention policies
3. Configure alerts for errors

## SSL/TLS Configuration

1. Obtain SSL certificates (Let's Encrypt)
2. Configure reverse proxy (Nginx/Apache)
3. Enable HTTPS redirect
4. Configure HSTS headers

## Scaling

### Horizontal Scaling

```bash
# Kubernetes
kubectl scale deployment payment-gateway --replicas=5

# Docker Swarm
docker service scale payment-gateway=5
```

### Auto-scaling

Configure based on:
- CPU utilization (>70%)
- Memory usage (>80%)
- Request rate (>1000 req/s)

## Backup & Recovery

### Database Backups
```bash
# Automated daily backups
0 2 * * * pg_dump payment_gateway > backup_$(date +\%Y\%m\%d).sql
```

### Disaster Recovery
- Multi-region deployment
- Regular DR drills
- RTO: 4 hours
- RPO: 1 hour

## Security Hardening

1. Use secrets management (Vault/AWS Secrets Manager)
2. Enable WAF
3. Configure DDoS protection
4. Regular security scans
5. Implement network policies

## Performance Optimization

1. Enable caching (Redis)
2. Use CDN for static assets
3. Database query optimization
4. Connection pooling
5. Load balancing

## CI/CD Pipeline

### GitHub Actions

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Build and deploy
        run: |
          docker build -t payment-gateway .
          # Deploy commands
```

## Troubleshooting

### Common Issues

1. **Connection timeouts**
   - Check security groups
   - Verify network policies
   - Check DNS resolution

2. **High memory usage**
   - Check for memory leaks
   - Review connection pools
   - Monitor garbage collection

3. **Slow response times**
   - Check database queries
   - Review cache hit rates
   - Analyze slow endpoints

## Rollback Procedure

```bash
# Kubernetes
kubectl rollout undo deployment/payment-gateway

# Docker
docker-compose down
docker-compose up -d --force-recreate
```

## Support

For deployment support:
- DevOps Team: devops@paymentgateway.com
- Documentation: https://docs.paymentgateway.com/deployment
