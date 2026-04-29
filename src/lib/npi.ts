// src/lib/npi.ts
//
// NPI (National Provider Identifier) validation. Uses Luhn checksum with
// the "80840" CMS healthcare prefix per CMS NPI documentation.

export function isValidNpi(input: string | null | undefined): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  if (!/^\d{10}$/.test(trimmed)) return false;

  const prefixed = `80840${trimmed.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < prefixed.length; i++) {
    let digit = Number.parseInt(prefixed[prefixed.length - 1 - i]!, 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number.parseInt(trimmed[9]!, 10);
}
