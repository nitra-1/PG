/**
 * QR Code Webhook Integration Example
 * 
 * This example demonstrates how to:
 * 1. Generate a QR code for payment
 * 2. Simulate a webhook callback from UPI PSP
 * 3. Retrieve transaction details
 */

const axios = require('axios');

// Configuration
const API_BASE_URL = 'http://localhost:3000/api';
const AUTH_TOKEN = 'your-jwt-token-here'; // Replace with actual token

// Example 1: Generate Dynamic QR Code
async function generateDynamicQR() {
  console.log('\n=== Generating Dynamic QR Code ===');
  
  try {
    const response = await axios.post(
      `${API_BASE_URL}/qr/dynamic`,
      {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 250,
        orderId: 'ORDER_12345',
        description: 'Coffee and Sandwich',
        expiryMinutes: 30
      },
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✓ QR Code Generated:');
    console.log('  QR Code ID:', response.data.qrCodeId);
    console.log('  Order ID:', response.data.orderId);
    console.log('  Amount:', response.data.amount);
    console.log('  Expiry Time:', response.data.expiryTime);
    console.log('  QR Image:', response.data.qrCodeImage.substring(0, 50) + '...');
    
    return response.data;
  } catch (error) {
    console.error('✗ Error generating QR:', error.response?.data || error.message);
    throw error;
  }
}

// Example 2: Simulate Webhook Callback (when user pays via UPI app)
async function simulateWebhookCallback(qrCodeId) {
  console.log('\n=== Simulating Webhook Callback ===');
  console.log('(This would normally be sent by UPI Payment Service Provider)');
  
  try {
    const webhookData = {
      qrCodeId: qrCodeId,
      transactionId: `UPI_TXN_${Date.now()}`,
      merchantId: 'MERCHANT_001',
      amount: 250,
      orderId: 'ORDER_12345',
      customerVPA: 'customer@paytm',
      customerName: 'John Doe',
      utr: `UTR${Date.now()}`,
      status: 'SUCCESS',
      timestamp: new Date().toISOString()
    };
    
    console.log('Sending webhook payload:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(
      `${API_BASE_URL}/qr/webhook`,
      webhookData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('\n✓ Webhook Processed:');
    console.log('  Success:', response.data.success);
    console.log('  Acknowledged:', response.data.acknowledged);
    console.log('  Transaction ID:', response.data.transactionId);
    console.log('  Status:', response.data.status);
    
    return response.data;
  } catch (error) {
    console.error('✗ Error processing webhook:', error.response?.data || error.message);
    throw error;
  }
}

// Example 3: Get QR Code Transactions
async function getQRTransactions(qrCodeId) {
  console.log('\n=== Retrieving QR Transactions ===');
  
  try {
    const response = await axios.get(
      `${API_BASE_URL}/qr/${qrCodeId}/transactions`,
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`
        }
      }
    );
    
    console.log('✓ Transactions Retrieved:');
    console.log('  Total Transactions:', response.data.total);
    console.log('  Total Amount:', response.data.totalAmount);
    console.log('  Transactions:', JSON.stringify(response.data.transactions, null, 2));
    
    return response.data;
  } catch (error) {
    console.error('✗ Error getting transactions:', error.response?.data || error.message);
    throw error;
  }
}

// Example 4: Get QR Code Details
async function getQRDetails(qrCodeId) {
  console.log('\n=== Getting QR Code Details ===');
  
  try {
    const response = await axios.get(
      `${API_BASE_URL}/qr/${qrCodeId}`,
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`
        }
      }
    );
    
    console.log('✓ QR Code Details:');
    console.log('  QR Code ID:', response.data.qrCodeId);
    console.log('  Type:', response.data.type);
    console.log('  Status:', response.data.status);
    console.log('  Total Transactions:', response.data.totalTransactions);
    console.log('  Total Amount:', response.data.totalAmount);
    console.log('  Last Payment:', response.data.lastPaymentAt);
    
    return response.data;
  } catch (error) {
    console.error('✗ Error getting QR details:', error.response?.data || error.message);
    throw error;
  }
}

// Example 5: Complete Flow
async function completeQRPaymentFlow() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   QR Code Payment Flow with Webhook Integration       ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  try {
    // Step 1: Generate QR Code
    const qrCode = await generateDynamicQR();
    
    // Step 2: Wait a moment (simulating customer scanning and paying)
    console.log('\n⏳ Customer scans QR code and pays via UPI app...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 3: Webhook callback received (simulated)
    await simulateWebhookCallback(qrCode.qrCodeId);
    
    // Step 4: Verify transaction stored
    await new Promise(resolve => setTimeout(resolve, 1000));
    await getQRTransactions(qrCode.qrCodeId);
    
    // Step 5: Get updated QR details
    await getQRDetails(qrCode.qrCodeId);
    
    console.log('\n✓ Complete flow executed successfully!');
    
  } catch (error) {
    console.error('\n✗ Flow failed:', error.message);
  }
}

// Static QR Example
async function staticQRExample() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║        Static QR Code with Multiple Payments          ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  try {
    // Generate static QR
    console.log('\n=== Generating Static QR Code ===');
    const response = await axios.post(
      `${API_BASE_URL}/qr/static`,
      {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        storeId: 'STORE_001',
        storeName: 'Downtown Branch'
      },
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const qrCodeId = response.data.qrCodeId;
    console.log('✓ Static QR Generated:', qrCodeId);
    
    // Simulate 3 different customers paying
    console.log('\n⏳ Simulating 3 customer payments...');
    
    for (let i = 1; i <= 3; i++) {
      await axios.post(
        `${API_BASE_URL}/qr/webhook`,
        {
          qrCodeId: qrCodeId,
          transactionId: `UPI_TXN_${Date.now()}_${i}`,
          amount: 100 + (i * 50),
          customerVPA: `customer${i}@gpay`,
          customerName: `Customer ${i}`,
          utr: `UTR${Date.now()}_${i}`,
          status: 'SUCCESS'
        }
      );
      
      console.log(`  ✓ Payment ${i} processed`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Check transactions
    await getQRTransactions(qrCodeId);
    await getQRDetails(qrCodeId);
    
    console.log('\n✓ Static QR example completed!');
    
  } catch (error) {
    console.error('\n✗ Static QR example failed:', error.message);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const example = args[0] || 'complete';
  
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║         QR Code Webhook Integration Examples          ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('\nNOTE: Update AUTH_TOKEN in this file before running');
  console.log('      Server should be running on http://localhost:3000\n');
  
  if (example === 'complete') {
    await completeQRPaymentFlow();
  } else if (example === 'static') {
    await staticQRExample();
  } else {
    console.log('Usage:');
    console.log('  node qr-webhook-example.js [complete|static]');
    console.log('');
    console.log('Examples:');
    console.log('  node qr-webhook-example.js complete  # Complete flow with dynamic QR');
    console.log('  node qr-webhook-example.js static    # Static QR with multiple payments');
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  generateDynamicQR,
  simulateWebhookCallback,
  getQRTransactions,
  getQRDetails,
  completeQRPaymentFlow,
  staticQRExample
};
