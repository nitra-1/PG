/**
 * Seed file for initial merchants (tenants)
 */

exports.seed = async function(knex) {
  // Deletes ALL existing entries
  await knex('merchants').del();
  
  // Inserts seed entries
  await knex('merchants').insert([
    {
      id: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61',
      merchant_code: 'DEMO_MERCHANT_001',
      merchant_name: 'Demo Merchant 1',
      business_type: 'E-commerce',
      email: 'merchant1@example.com',
      phone: '+919876543210',
      address: JSON.stringify({
        street: '123 Business Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        postal_code: '400001'
      }),
      status: 'active',
      settings: JSON.stringify({
        payment_methods: ['upi', 'cards', 'netbanking', 'wallets'],
        auto_capture: true,
        webhook_enabled: true,
        settlement_cycle: 'T+1'
      }),
      balance: 0
    },
    {
      id: knex.raw('gen_random_uuid()'),
      merchant_code: 'DEMO_MERCHANT_002',
      merchant_name: 'Demo Merchant 2',
      business_type: 'Services',
      email: 'merchant2@example.com',
      phone: '+919876543211',
      address: JSON.stringify({
        street: '456 Service Road',
        city: 'Bangalore',
        state: 'Karnataka',
        country: 'India',
        postal_code: '560001'
      }),
      status: 'active',
      settings: JSON.stringify({
        payment_methods: ['upi', 'cards', 'wallets'],
        auto_capture: false,
        webhook_enabled: true,
        settlement_cycle: 'T+2'
      }),
      balance: 0
    }
  ]);
};
