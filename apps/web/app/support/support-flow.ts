export function normalizeSupportAmount(value: string | number | null | undefined) {
  if (value === "" || value === null || value === undefined) return null;
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) return null;
  return amount;
}

export function buildSupportConfirmation(amountValue: string | number, messageValue = "") {
  const amount = normalizeSupportAmount(amountValue);
  if (amount === null) return null;

  return {
    amount,
    anonymous: true as const,
    message: String(messageValue).trim().slice(0, 100),
  };
}
