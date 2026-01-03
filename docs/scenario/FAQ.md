# Frequently Asked Questions (FAQ)

## General Questions

### Q1: What is the minimum transaction volume required to onboard?
**A:** There is no minimum transaction volume requirement. We welcome businesses of all sizes, from startups to enterprises. Our pricing is structured in tiers based on your monthly transaction volume, with better rates for higher volumes.

### Q2: How long does the onboarding process take?
**A:** The complete onboarding process typically takes **7-10 business days** for standard merchants. Premium and enterprise merchants can be onboarded in **5-7 business days** through our fast-track program.

### Q3: What payment methods do you support?
**A:** We support:
- **UPI** (PhonePe, Google Pay, Paytm, BHIM)
- **Credit/Debit Cards** (Visa, Mastercard, RuPay, Amex)
- **Net Banking** (All major banks)
- **Digital Wallets** (Paytm, PhonePe, Amazon Pay, Google Pay)
- **BNPL** (Buy Now Pay Later)
- **EMI** (3, 6, 9, 12, 18, 24 months)
- **QR Code payments**
- **Biometric payments**

### Q4: What are your pricing/MDR rates?
**A:** Our pricing is transparent and competitive:
- **UPI**: 0% MDR (as per RBI guidelines)
- **Credit Cards**: 1.2% - 2.0% (based on volume)
- **Debit Cards**: 0.9% - 1.5% (based on volume)
- **Net Banking**: 1.5% - 2.0%
- **Wallets**: 1.5% - 1.8%
- **EMI**: Varies by tenure (typically 13-15%)

Plus 18% GST on MDR. No setup fees or hidden charges.

### Q5: When will I receive my settlement?
**A:** We offer **T+1 settlement**, meaning funds from successful transactions on Day 0 are transferred to your bank account on Day 1. Settlements are processed between 8-10 AM daily.

## Technical Questions

### Q6: Do I need to be PCI-DSS compliant?
**A:** No, you don't need to be PCI-DSS compliant. Our platform is PCI-DSS Level 1 certified, which means we handle all sensitive card data securely. You never store or process card information directly, reducing your compliance burden.

### Q7: Can I use the same API keys for testing and production?
**A:** No, we provide separate API keys for sandbox (testing) and production environments:
- **Sandbox**: `pk_test_*` and `sk_test_*`
- **Production**: `pk_live_*` and `sk_live_*`

Always use sandbox credentials during development and testing, and switch to production credentials only when you're ready to go live.

### Q8: How do I handle webhooks?
**A:** Webhooks are HTTP callbacks sent to your server when events occur (e.g., payment success, refund processed). To handle webhooks:

1. Set up an HTTPS endpoint on your server
2. Verify the webhook signature using the webhook secret
3. Process the event
4. Return a 200 OK response

Example:
```javascript
app.post('/webhook/payment', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  // Verify signature
  if (verifySignature(req.body, signature)) {
    // Process event
    handlePaymentEvent(req.body);
    res.status(200).json({ received: true });
  } else {
    res.status(400).json({ error: 'Invalid signature' });
  }
});
```

### Q9: What happens if my webhook endpoint is down?
**A:** We have a robust retry mechanism:
- First attempt: Immediately after event
- Retry 1: After 5 minutes
- Retry 2: After 15 minutes
- Retry 3: After 1 hour
- Retry 4: After 4 hours
- Retry 5: After 24 hours

After 5 failed attempts, the webhook event is marked as failed and requires manual investigation.

### Q10: Can I customize the checkout page?
**A:** Yes! We offer multiple customization options:

1. **Hosted Checkout**: Use our fully hosted checkout page with your logo and brand colors
2. **Embedded Checkout**: Embed our checkout widget in your website with full customization
3. **Custom Integration**: Build your own checkout UI and use our APIs directly

## Payment Questions

### Q11: What is the success rate for payments?
**A:** Our overall payment success rate is **96-97%**, which is industry-leading. Success rates vary by payment method:
- UPI: ~98%
- Cards: ~95-96%
- Net Banking: ~94-95%
- Wallets: ~97%

We use smart routing and automatic failover to maximize success rates.

### Q12: Why do payments fail?
**A:** Common reasons for payment failures:
- **Insufficient funds** (40%)
- **Bank/issuer decline** (30%)
- **Technical timeout** (15%)
- **Incorrect credentials** (10%)
- **Other** (5%)

We provide detailed failure reasons in our API responses and merchant dashboard.

### Q13: Can I process refunds?
**A:** Yes, you can process both full and partial refunds through:
- **API**: Programmatically via our refund API
- **Dashboard**: Manually through the merchant dashboard

Refund processing time:
- Instant refund initiation
- Customer receives refund in 5-7 business days (bank-dependent)

### Q14: What is the maximum transaction amount?
**A:** Transaction limits vary by payment method:
- **UPI**: ₹1,00,000 per transaction
- **Cards**: ₹2,00,000 per transaction (can be increased for verified merchants)
- **Net Banking**: ₹10,00,000 per transaction
- **Wallets**: ₹10,000 per transaction

Enterprise merchants can request higher limits based on business needs.

### Q15: Do you support international payments?
**A:** Yes, we support international card payments. Requirements:
- International payment gateway enabled on your account
- Additional KYC documentation
- Higher MDR rates (2.5-3.5%)
- Currency conversion handled automatically

## Settlement & Finance Questions

### Q16: How do I download settlement reports?
**A:** Settlement reports are available in your merchant dashboard:
1. Login to dashboard
2. Navigate to **Reports → Settlements**
3. Select date range
4. Download as CSV, Excel, or PDF

Reports are also emailed to your registered email address daily.

### Q17: What charges are deducted from settlements?
**A:** From each successful transaction:
- **MDR** (Merchant Discount Rate): As per your pricing plan
- **GST**: 18% on MDR
- **Refunds**: Deducted from settlements (MDR not refunded)
- **Chargebacks**: Deducted with additional penalty

Net Settlement = Gross Amount - MDR - GST - Refunds - Chargebacks

### Q18: Can I get instant settlements?
**A:** Yes, we offer **Instant Settlement** as an add-on feature:
- Settlements within 15 minutes of transaction
- Additional fee: 0.5% on settled amount
- Available for verified merchants with good track record
- Subject to daily limits

Contact your account manager to enable this feature.

### Q19: What if there's a settlement discrepancy?
**A:** If you notice a discrepancy:
1. Check the settlement report for detailed breakdown
2. Verify all transactions were successful
3. Check for refunds, chargebacks, or adjustments
4. Contact support with:
   - Settlement ID
   - Expected amount
   - Actual amount
   - Transaction details

We typically resolve discrepancies within 24-48 hours.

## Security & Compliance Questions

### Q20: How is my data secured?
**A:** We implement multiple security layers:
- **Encryption**: AES-256 encryption at rest, TLS 1.3 in transit
- **Tokenization**: Card data never stored, only tokens
- **PCI-DSS**: Level 1 certified
- **Compliance**: GDPR, DPDP Act compliant
- **Monitoring**: 24/7 security monitoring
- **Audits**: Regular security audits and penetration testing

### Q21: What happens if there's a data breach?
**A:** We have a comprehensive incident response plan:
- Immediate containment and investigation
- Notification within 24 hours
- Regulatory reporting within 72 hours
- Free credit monitoring for affected users
- Full transparency on the incident

However, with our security measures, the risk is minimal.

### Q22: How do you prevent fraud?
**A:** Multi-layered fraud prevention:
- **Rule-based detection**: Velocity checks, amount limits
- **Machine learning**: Behavioral analysis, pattern recognition
- **3D Secure**: Cardholder authentication
- **Device fingerprinting**: Track suspicious devices
- **Manual review**: High-risk transactions reviewed manually

### Q23: What is 3D Secure?
**A:** 3D Secure (3DS) is an additional security layer for card payments where the cardholder must authenticate with their bank (typically via OTP). Benefits:
- Reduces fraud
- Shifts liability to the card issuer
- Required for certain high-value transactions
- May slightly reduce conversion (due to extra step)

We support both 3DS 1.0 and 3DS 2.0.

## Support Questions

### Q24: What support channels are available?
**A:**
- **Email**: support@paymentgateway.com (24/7)
- **Phone**: +91-80-1234-5678 (24/7)
- **Chat**: Live chat in merchant dashboard (24/7)
- **WhatsApp**: +91-98765-43210 (Business hours)
- **Slack**: Dedicated channel for enterprise merchants
- **Developer Forum**: community.paymentgateway.com

### Q25: What are your support response times?
**A:**
- **Critical issues**: < 15 minutes
- **High priority**: < 1 hour
- **Medium priority**: < 4 hours
- **Low priority**: < 24 hours

Enterprise merchants get dedicated account managers and priority support.

### Q26: Do you provide integration assistance?
**A:** Yes! We provide:
- **Documentation**: Comprehensive API docs and guides
- **SDKs**: Pre-built libraries for popular languages
- **Code examples**: Sample implementations
- **Technical support**: Dedicated integration support team
- **Onboarding assistance**: Hands-on help during integration
- **Developer webinars**: Regular training sessions

## Business Questions

### Q27: Can I have multiple websites under one account?
**A:** Yes, you can manage multiple websites/brands under one merchant account. Each can have:
- Separate branding
- Different webhook URLs
- Individual reporting
- Shared or separate settlement accounts

### Q28: Do you support subscriptions/recurring payments?
**A:** Yes, we support:
- **Standing Instructions**: For UPI and cards
- **Token-based recurring**: Save card tokens for future charges
- **Subscription management**: APIs to manage subscription lifecycle
- **Automatic retries**: For failed subscription payments
- **Customer notifications**: Automated payment reminders

### Q29: What is your refund policy for merchant fees?
**A:** MDR charges are non-refundable. When you process a refund:
- Customer receives full refund amount
- MDR already charged is not refunded to merchant
- No additional fee for processing refunds

Example: ₹1000 transaction with 2% MDR
- You receive: ₹980
- Customer gets refund: ₹1000
- You pay refund: ₹1000
- Net loss: ₹20 (MDR)

### Q30: Can I white-label your solution?
**A:** Yes, we offer white-label solutions for:
- **Banks**: Offer payment gateway to your merchants
- **Platforms**: Integrate payments for your marketplace
- **Resellers**: Become a payment service reseller

Contact our business team for white-label partnerships.

## Getting Started

### Q31: How do I get started?
**A:** Simple 5-step process:
1. **Sign up**: Register at merchant.paymentgateway.com
2. **Submit documents**: Upload KYC documents
3. **Agreement**: Sign merchant agreement
4. **Integration**: Integrate using our APIs/SDKs
5. **Go live**: Test, get approval, go live!

### Q32: Do you have a sandbox/test environment?
**A:** Yes! Our sandbox environment provides:
- Full feature parity with production
- Test API keys
- Test payment credentials
- Unlimited testing
- No charges

Use these test credentials:
- **Success UPI**: success@pgtestupi
- **Success Card**: 4111 1111 1111 1111
- **Failure Card**: 4000 0000 0000 0002

### Q33: Can I migrate from another payment gateway?
**A:** Yes, we offer hassle-free migration:
- Dedicated migration support team
- No downtime during migration
- Data migration assistance
- Parallel running option
- Competitive pricing for migrations

Contact us at migrations@paymentgateway.com

### Q34: What documentation is available?
**A:** Comprehensive documentation:
- **API Reference**: Complete API documentation
- **Integration Guides**: Step-by-step integration tutorials
- **SDKs**: Libraries for Node.js, Python, PHP, Java, .NET
- **Code Examples**: Sample implementations
- **Video Tutorials**: Visual learning resources
- **Scenario Guides**: Real-world use cases

Available at: docs.paymentgateway.com

### Q35: Still have questions?
**A:** We're here to help!
- Email: support@paymentgateway.com
- Phone: +91-80-1234-5678
- Chat: merchant.paymentgateway.com
- Schedule a demo: sales@paymentgateway.com

---

**Last Updated**: January 2026  
**Version**: 1.0

For more detailed information, please refer to our complete documentation suite in the `docs/scenario` directory.
