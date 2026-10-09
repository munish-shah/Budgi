import { describe, expect, it } from 'vitest';
import { cleanDescription, lookupMerchant, merchantKey, heuristicCategory } from '../src/merchants';

describe('cleanDescription', () => {
  it.each([
    ['SQ *BLUE BOTTLE COFFE 0123  OAKLAND CA', 'Blue Bottle Coffe'],
    ['STARBUCKS STORE 08211   SAN FRANCISCO CA', 'Starbucks'],
    ["TRADER JOE'S #236 QPS  SAN FRANCISCO CA", "Trader Joe's Qps"],
    ['TST* LITTLE STAR PIZZA SAN FRANCISCO CA', 'Little Star Pizza'],
    ['NETFLIX.COM 866-579-7172 CA', 'Netflix'],
    ['AMZN Mktp US*2K4L19P02', 'Amzn Mktp'],
    ['CHECKCARD 0412 SHAKE SHACK 1234 NEW YORK NY', 'Shake Shack'],
    ['PURCHASE AUTHORIZED ON 03/14 SWEETGREEN 2211 SAN FRANCISCO CA', 'Sweetgreen'],
  ])('%s -> %s', (raw, expected) => {
    expect(cleanDescription(raw)).toBe(expected);
  });

  it('never returns an empty string', () => {
    expect(cleanDescription('#1234 5678')).not.toBe('');
  });
});

describe('lookupMerchant', () => {
  it('prefers Uber Eats over Uber', () => {
    expect(lookupMerchant('UBER *EATS PENDING')).toEqual({ name: 'Uber Eats', categoryId: 'dining' });
    expect(lookupMerchant('UBER *TRIP HELP.UBER.COM')).toEqual({ name: 'Uber', categoryId: 'transport' });
  });
  it('recognizes card payments as transfers', () => {
    expect(lookupMerchant('PAYMENT THANK YOU - WEB')?.categoryId).toBe('transfer');
    expect(lookupMerchant('CHASE CREDIT CRD AUTOPAY PPD')?.categoryId).toBe('transfer');
  });
  it('uses provider merchant name too', () => {
    expect(lookupMerchant('POS 1234', 'Whole Foods Market')?.categoryId).toBe('groceries');
  });
  it('distinguishes Amazon Prime from Amazon shopping', () => {
    expect(lookupMerchant('AMZN Mktp US*2K4L19P02')?.categoryId).toBe('shopping');
    expect(lookupMerchant('AMAZON PRIME*1A2B3C')?.categoryId).toBe('subscriptions');
  });
  it('maps payroll to income', () => {
    expect(lookupMerchant('ACME CORP PAYROLL PPD ID: 9876543210')).toEqual({ name: '', categoryId: 'income' });
  });
});

describe('heuristics & keys', () => {
  it('guesses from keywords', () => {
    expect(heuristicCategory('SQ *MOONLIGHT TAQUERIA')).toBe('dining');
    expect(heuristicCategory('BI-RITE MARKET')).toBe('groceries');
    expect(heuristicCategory('NOPA SALON')).toBe('personal');
  });
  it('merchantKey is stable', () => {
    expect(merchantKey("  Trader Joe's  ")).toBe('trader joe s');
    expect(merchantKey('Café Réveille')).toBe('cafe reveille');
  });
});
