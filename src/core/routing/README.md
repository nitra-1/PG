# Payment Gateway Routing Layer

This directory contains the smart routing system for payment gateway selection and management.

## 📚 Documentation

For comprehensive documentation on how the routing algorithm works, please refer to:

**[ROUTING_DOCUMENTATION.md](./ROUTING_DOCUMENTATION.md)**

## 🗂️ Files

- **`smart-router.js`** - Main smart router implementation with multiple routing strategies
- **`gateway-health-tracker.js`** - Gateway health monitoring and metrics tracking
- **`ROUTING_DOCUMENTATION.md`** - Complete documentation of the routing system

## 🚀 Quick Start

```javascript
const { SmartRouter, RoutingStrategy } = require('./smart-router');

// Initialize router with health-based routing
const router = new SmartRouter({
  strategy: RoutingStrategy.HEALTH_BASED,
  gatewayPriority: ['razorpay', 'payu', 'ccavenue']
});

// Select optimal gateway
const gateway = router.selectGateway({
  amount: 1000,
  currency: 'INR'
});

console.log(`Selected gateway: ${gateway}`);
```

## 📖 What You'll Learn

The comprehensive documentation covers:

1. **Overview** - System architecture and problem statement
2. **Core Components** - Smart Router and Health Tracker details
3. **Routing Strategies** - 5 different routing algorithms:
   - Health-Based (Default)
   - Round-Robin
   - Cost-Optimized
   - Latency-Based
   - Priority-Based
4. **Health Tracking** - Real-time gateway monitoring and scoring
5. **Fallback Mechanism** - Automatic failover to backup gateways
6. **Usage Examples** - Practical implementation examples
7. **Configuration** - Complete configuration reference
8. **Best Practices** - Production deployment guidelines
9. **Troubleshooting** - Common issues and solutions

## 🎯 Key Features

- ✅ Multiple routing strategies for different use cases
- ✅ Real-time health monitoring with scoring (0-100)
- ✅ Automatic fallback to backup gateways
- ✅ Performance metrics tracking (success rate, latency, etc.)
- ✅ Flexible configuration
- ✅ Production-ready with comprehensive testing

## 🔗 Related Tests

Unit tests for the routing system can be found at:
- `/tests/smart-router.test.js`

## 📞 Support

For questions or issues with the routing system, please refer to the comprehensive documentation or contact the development team.
