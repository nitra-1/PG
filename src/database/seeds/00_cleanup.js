exports.seed = async function (knex) {
  await knex.raw(`
    TRUNCATE TABLE
      ledger_entries,
      ledger_accounts,
      settlements,
      transactions,
      payment_orders
    RESTART IDENTITY CASCADE
  `);
};