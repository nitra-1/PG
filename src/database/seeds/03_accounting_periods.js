/**
 * Seed file for accounting periods
 * Creates default open accounting periods for all merchants
 */

exports.seed = async function(knex) {
  // Check if accounting_periods table exists
  const hasTable = await knex.schema.hasTable('accounting_periods');
  if (!hasTable) {
    console.log('⚠️  accounting_periods table does not exist yet. Skipping seed.');
    return;
  }

  // Get all merchants
  const merchants = await knex('merchants').select('id');
  
  if (merchants.length === 0) {
    console.log('⚠️  No merchants found. Skipping accounting periods seed.');
    return;
  }

  const currentDate = new Date();
  const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  
  console.log(`Creating accounting periods for ${merchants.length} merchant(s)...`);
  console.log(`Period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`);

  // Create accounting periods for each merchant
  const periods = [];
  for (const merchant of merchants) {
    // Check if period already exists
    const existingPeriod = await knex('accounting_periods')
      .where({
        tenant_id: merchant.id,
        period_type: 'MONTHLY',
        period_start: periodStart
      })
      .first();

    if (!existingPeriod) {
      periods.push({
        tenant_id: merchant.id,
        period_type: 'MONTHLY',
        period_start: periodStart,
        period_end: periodEnd,
        status: 'OPEN',
        created_by: 'system_seed',
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    } else {
      console.log(`  ✓ Period already exists for merchant ${merchant.id}`);
    }
  }

  if (periods.length > 0) {
    await knex('accounting_periods').insert(periods);
    console.log(`✓ Created ${periods.length} accounting period(s)`);
  } else {
    console.log('✓ All merchants already have accounting periods');
  }
};
