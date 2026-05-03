const db = require('../../database');

const AMOUNT_TOLERANCE = Number(process.env.GATEWAY_SETTLEMENT_AMOUNT_TOLERANCE || 0.01);

function roundMoney(value) {
  const amount = Number(value || 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function absDiff(left, right) {
  return roundMoney(Math.abs(Number(left || 0) - Number(right || 0)));
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

class GatewayFeeValidationService {
  async findApplicablePricingRule({ tenantId, merchantId = null, gatewayName, paymentMethod = null, transactionDate = new Date() }) {
    if (!tenantId || !gatewayName) return null;

    const date = transactionDate ? new Date(transactionDate) : new Date();
    const rules = await db.knex('pricing_rules')
      .where('tenant_id', tenantId)
      .where('gateway_name', String(gatewayName).toLowerCase())
      .where('status', 'ACTIVE')
      .where('effective_from', '<=', date)
      .where(function() {
        this.whereNull('effective_to').orWhere('effective_to', '>=', date);
      })
      .where(function() {
        if (merchantId) this.where('merchant_id', merchantId).orWhereNull('merchant_id');
        else this.whereNull('merchant_id');
      })
      .where(function() {
        if (paymentMethod) this.where('payment_method', paymentMethod).orWhereNull('payment_method');
        else this.whereNull('payment_method');
      })
      .orderByRaw('CASE WHEN merchant_id IS NOT NULL THEN 0 ELSE 1 END')
      .orderByRaw('CASE WHEN payment_method IS NOT NULL THEN 0 ELSE 1 END')
      .orderBy('effective_from', 'desc')
      .limit(1);

    return rules[0] || null;
  }

  calculateExpectedFee({ amount, pricingRule }) {
    if (!pricingRule) return null;

    const gross = Number(amount || 0);
    const percentageFee = pricingRule.mdr_percentage !== null && pricingRule.mdr_percentage !== undefined
      ? gross * (Number(pricingRule.mdr_percentage) / 100)
      : 0;
    const fixedFee = pricingRule.fixed_fee !== null && pricingRule.fixed_fee !== undefined
      ? Number(pricingRule.fixed_fee)
      : 0;

    if (pricingRule.rule_type === 'MDR_PERCENTAGE') return roundMoney(percentageFee);
    if (pricingRule.rule_type === 'FIXED_FEE') return roundMoney(fixedFee);
    return roundMoney(percentageFee + fixedFee);
  }

  calculateExpectedGST({ fee, pricingRule }) {
    if (!pricingRule) return null;
    const gstPercentage = pricingRule.gst_percentage !== null && pricingRule.gst_percentage !== undefined
      ? Number(pricingRule.gst_percentage)
      : 0;
    return roundMoney(Number(fee || 0) * (gstPercentage / 100));
  }

  expectedNet({ grossAmount, gatewayFee, gstAmount, adjustmentAmount }) {
    return roundMoney(Number(grossAmount || 0) - Number(gatewayFee || 0) - Number(gstAmount || 0) + Number(adjustmentAmount || 0));
  }

  async validateGatewayLineFees(line, transaction = null) {
    const merchantId = line.merchant_id || transaction?.merchant_id || transaction?.tenant_id || line.tenant_id;
    const paymentMethod = transaction?.payment_method || parseJson(transaction?.metadata).payment_method || null;
    const transactionDate = line.captured_at || line.transaction_date || transaction?.completed_at || transaction?.created_at || new Date();
    const pricingRule = await this.findApplicablePricingRule({
      tenantId: line.tenant_id,
      merchantId,
      gatewayName: line.gateway_name,
      paymentMethod,
      transactionDate
    });

    if (!pricingRule) {
      return {
        pricingRule: null,
        pricingSnapshot: null,
        pricingRuleMissing: true,
        expectedGatewayFee: null,
        expectedGstAmount: null,
        expectedNetAmount: null,
        feeDiscrepancyAmount: null,
        gstDiscrepancyAmount: null,
        netDiscrepancyAmount: null,
        feeMismatch: false,
        gstMismatch: false,
        netMismatch: false
      };
    }

    const expectedGatewayFee = this.calculateExpectedFee({ amount: line.gross_amount, pricingRule });
    const expectedGstAmount = this.calculateExpectedGST({ fee: expectedGatewayFee, pricingRule });
    const expectedNetAmount = this.expectedNet({
      grossAmount: line.gross_amount,
      gatewayFee: line.gateway_fee,
      gstAmount: line.gst_amount,
      adjustmentAmount: line.adjustment_amount
    });
    const feeDiscrepancyAmount = absDiff(line.gateway_fee, expectedGatewayFee);
    const gstDiscrepancyAmount = absDiff(line.gst_amount, expectedGstAmount);
    const netDiscrepancyAmount = absDiff(line.net_amount, expectedNetAmount);

    return {
      pricingRule,
      pricingSnapshot: {
        id: pricingRule.id,
        rule_type: pricingRule.rule_type,
        mdr_percentage: pricingRule.mdr_percentage,
        fixed_fee: pricingRule.fixed_fee,
        gst_percentage: pricingRule.gst_percentage,
        effective_from: pricingRule.effective_from,
        effective_to: pricingRule.effective_to
      },
      pricingRuleMissing: false,
      expectedGatewayFee,
      expectedGstAmount,
      expectedNetAmount,
      feeDiscrepancyAmount,
      gstDiscrepancyAmount,
      netDiscrepancyAmount,
      feeMismatch: feeDiscrepancyAmount > AMOUNT_TOLERANCE,
      gstMismatch: gstDiscrepancyAmount > AMOUNT_TOLERANCE,
      netMismatch: netDiscrepancyAmount > AMOUNT_TOLERANCE
    };
  }
}

module.exports = new GatewayFeeValidationService();
module.exports.GatewayFeeValidationService = GatewayFeeValidationService;
module.exports.roundMoney = roundMoney;
module.exports.absDiff = absDiff;
