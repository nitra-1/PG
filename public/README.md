# Payment Gateway Checkout Demo

This directory contains the sample checkout page that demonstrates all payment methods supported by the payment gateway.

## Files

- `checkout.html` - Comprehensive checkout page with all payment methods

## Features

The checkout demo page includes:

### Payment Methods
1. **UPI Payment** - Pay using UPI VPA (e.g., user@bank)
2. **Card Payment** - Credit/Debit card payments with EMI options
3. **Net Banking** - Direct bank transfers from major banks
4. **Digital Wallets** - Paytm, PhonePe, Google Pay, Amazon Pay
5. **QR Code** - Generate dynamic QR codes for payment
6. **BNPL (Buy Now Pay Later)** - Credit assessment and installment plans
7. **EMI Payment** - Convert payments to easy monthly installments (3, 6, 9, 12 months)
8. **Biometric Payment** - Fingerprint, Face Recognition, Aadhaar EKYC

### UI/UX Features
- Modern, responsive design
- Clean and intuitive interface
- Real-time form validation
- API response display
- Professional gradient design
- Mobile-friendly layout
- Interactive payment method selection
- Order summary sidebar
- Security badges and trust indicators

## How to Use

### 1. Start the Server

```bash
npm start
```

The server will start on `http://localhost:3000`

### 2. Access the Checkout Page

Open your browser and navigate to:
```
http://localhost:3000/checkout.html
```

### 3. Test Payments

The page automatically generates a demo authentication token when loaded. You can test any payment method by:

1. Selecting a payment method (UPI, Card, Wallet, etc.)
2. Filling in the required details
3. Clicking the payment button
4. Viewing the API response

### Sample Test Data

**UPI Payment:**
- UPI ID: `testuser@paytm`
- Customer Name: `John Doe`
- Mobile: `9876543210`

**Card Payment:**
- Card Number: `4111 1111 1111 1111`
- Cardholder: `John Doe`
- Expiry: `12/25`
- CVV: `123`

**Net Banking:**
- Select any bank from the dropdown
- Enter customer details

**Wallets:**
- Select wallet (Paytm, PhonePe, Google Pay, Amazon Pay)
- Enter registered mobile number

## API Integration

The checkout page integrates with the following API endpoints:

- `POST /api/demo/token` - Generate demo authentication token
- `POST /api/payments/process` - Process payment transactions
- `POST /api/qr/dynamic` - Generate dynamic QR codes

All API calls include:
- Automatic token generation
- Bearer token authentication
- Error handling
- Response display

## Security Features

- ✅ JWT-based authentication
- 🔒 Secure HTTPS/TLS communication
- 🛡️ PCI-DSS Level 1 Certified
- 📱 Real-time transaction monitoring
- 🔐 Encrypted payment data

## Development

The checkout page uses vanilla JavaScript (no frameworks required) with:
- Modern ES6+ syntax
- Async/await for API calls
- Fetch API for HTTP requests
- CSS Grid and Flexbox for layout
- CSS animations for smooth transitions

## Customization

You can customize the checkout page by modifying:

1. **Amount and Items** - Update the order summary section
2. **Payment Methods** - Add/remove payment options
3. **Styling** - Modify the CSS styles
4. **API Endpoints** - Update the `API_BASE_URL` in the script section
5. **Form Fields** - Add custom fields as needed

## Support

For issues or questions:
- Check the API documentation: `/docs/API.md`
- View integration guide: `/docs/ECOMMERCE_INTEGRATION.md`
- Report issues on GitHub

## License

MIT License - See LICENSE file for details
