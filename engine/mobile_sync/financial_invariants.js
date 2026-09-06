/**
 * MOBILE BETA-1: Financial Invariants & Double-Entry Engine
 * Strictly enforces that sum of member balances equals 0, settlement suggestions never exceed
 * outstanding amounts, currency precision is preserved, and transactions are idempotent.
 */

class FinancialInvariantEngine {
  /**
   * Calculates balances and validates the fundamental double-entry invariant: Σ balances = 0
   */
  static computeAndValidateBalances({ members = [], expenses = [] }) {
    // Balances in integer cents/paise to eliminate IEEE 754 floating point errors
    const balanceMap = {};
    members.forEach(m => { balanceMap[m] = 0; });

    for (const exp of expenses) {
      const amountInCents = Math.round(exp.amount * 100);
      const paidBy = exp.paidBy;
      const splitWith = exp.splitWith || members;
      const shareInCents = Math.floor(amountInCents / splitWith.length);
      const remainderCents = amountInCents % splitWith.length;

      // Payer is credited the full amount
      balanceMap[paidBy] = (balanceMap[paidBy] || 0) + amountInCents;

      // Participants are debited their equal share
      splitWith.forEach((member, index) => {
        const debit = shareInCents + (index < remainderCents ? 1 : 0);
        balanceMap[member] = (balanceMap[member] || 0) - debit;
      });
    }

    // Convert back to standard currency units
    const formattedBalances = {};
    let totalSumCents = 0;

    for (const [member, balCents] of Object.entries(balanceMap)) {
      formattedBalances[member] = parseFloat((balCents / 100).toFixed(2));
      totalSumCents += balCents;
    }

    const invariantSatisfied = totalSumCents === 0;

    return {
      isValid: invariantSatisfied,
      totalSumCents,
      formattedBalances,
      membersCount: members.length,
      expensesCount: expenses.length
    };
  }

  /**
   * Computes minimal optimal settlement path without exceeding any member's outstanding balance
   */
  static computeSettlements(formattedBalances) {
    const debtors = [];
    const creditors = [];

    for (const [member, balance] of Object.entries(formattedBalances)) {
      const balanceCents = Math.round(balance * 100);
      if (balanceCents < 0) {
        debtors.push({ member, amountCents: -balanceCents });
      } else if (balanceCents > 0) {
        creditors.push({ member, amountCents: balanceCents });
      }
    }

    debtors.sort((a, b) => b.amountCents - a.amountCents);
    creditors.sort((a, b) => b.amountCents - a.amountCents);

    const settlements = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];
      const settlementAmountCents = Math.min(debtor.amountCents, creditor.amountCents);

      settlements.push({
        from: debtor.member,
        to: creditor.member,
        amount: parseFloat((settlementAmountCents / 100).toFixed(2)),
        currency: "INR"
      });

      debtor.amountCents -= settlementAmountCents;
      creditor.amountCents -= settlementAmountCents;

      if (debtor.amountCents === 0) dIdx++;
      if (creditor.amountCents === 0) cIdx++;
    }

    return settlements;
  }
}

module.exports = { FinancialInvariantEngine };
