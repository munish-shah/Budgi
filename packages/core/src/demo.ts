/**
 * Deterministic demo data so the app is fully explorable before you connect a
 * bank. Raw descriptors are intentionally messy, like real bank feeds.
 */
import { UNCATEGORIZED } from './categories';
import { addDays, parseISODate, toISODate } from './dates';
import { cleanDescription } from './merchants';
import type { Account, ISODate, Transaction } from './types';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_CONNECTION = 'demo';

export function demoAccounts(now = new Date()): Account[] {
  const updatedAt = now.toISOString();
  const base = { provider: 'demo' as const, connectionId: DEMO_CONNECTION, currency: 'USD', updatedAt, institution: 'Demo Bank' };
  return [
    { ...base, id: 'demo_checking', name: 'Everyday Checking', mask: '4821', type: 'depository', subtype: 'checking', balance: 524_318, available: 524_318 },
    { ...base, id: 'demo_savings', name: 'High-Yield Savings', mask: '9033', type: 'depository', subtype: 'savings', balance: 1_842_250 },
    { ...base, id: 'demo_card', name: 'Rewards Card', mask: '1107', type: 'credit', subtype: 'credit card', balance: 186_442, institution: 'Demo Card Co.' },
    { ...base, id: 'demo_brokerage', name: 'Brokerage', mask: '7730', type: 'investment', subtype: 'brokerage', balance: 3_215_900, institution: 'Demo Invest' },
  ];
}

interface Spec {
  desc: string[];
  min: number;
  max: number;
  account?: string;
  pfc?: string;
}

const COFFEE: Spec = { desc: ['SQ *BLUE BOTTLE COFFE 0123  OAKLAND CA', 'STARBUCKS STORE 08211   SAN FRANCISCO CA', 'PHILZ COFFEE #14 SAN FRANCISCO', 'TST* SIGHTGLASS COFFEE SAN FRANCISCO CA'], min: 450, max: 900 };
const GROCERY: Spec = { desc: ["TRADER JOE'S #236 QPS  SAN FRANCISCO CA", 'WHOLEFDS MKT 10234 SAN FRANCISCO CA', 'SAFEWAY #1490  SAN FRANCISCO CA', 'BI-RITE MARKET SAN FRANCISCO CA'], min: 2800, max: 14_500 };
const DINING: Spec = { desc: ['SQ *MOONLIGHT TAQUERIA  OAKLAND CA', 'TST* LITTLE STAR PIZZA SAN FRANCISCO CA', 'SWEETGREEN 2211 SAN FRANCISCO', 'CHIPOTLE 2741 SAN FRANCISCO CA', 'DD *DOORDASH NOPALITO', 'UBER *EATS PENDING', 'OTTO RAMEN BAR SF', 'BURMA SUPERSTAR SAN FRANCISCO CA'], min: 1400, max: 7800 };
const TRANSPORT: Spec = { desc: ['UBER *TRIP HELP.UBER.COM CA', 'LYFT *RIDE SUN 8PM', 'CLIPPER SERVICE CONCORD CA', 'PARKMOBILE 4423'], min: 300, max: 3400 };
const SHOPPING: Spec = { desc: ['AMZN Mktp US*2K4L19P02', 'TARGET 00012345 SAN FRANCISCO CA', 'UNIQLO USA LLC SAN FRANCISCO', 'APPLE.COM/US 800-676-2775', 'ETSY.COM - MAKERSHOP'], min: 1200, max: 18_000 };
const FUN: Spec = { desc: ['AMC THEATRES 1000 VAN NESS', 'TICKETMASTER *GREEK THEATRE', 'STEAMGAMES.COM 4259522985', 'ALAMO DRAFTHOUSE NEW MISSION'], min: 1500, max: 9500 };
const GAS: Spec = { desc: ['CHEVRON 0091234 SAN FRANCISCO CA', 'SHELL OIL 57444212 DALY CITY CA', 'ARCO #42188 SAN BRUNO CA'], min: 3800, max: 7200 };

export function demoTransactions(today: ISODate = toISODate(new Date()), days = 150): Transaction[] {
  const rand = rng(424242);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!;
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const out: Transaction[] = [];
  let n = 0;

  const add = (date: ISODate, desc: string, amount: number, account = 'demo_card', extra: Partial<Transaction> = {}) => {
    if (date > today) return;
    out.push({
      id: `demo_${n++}`,
      accountId: account,
      provider: 'demo',
      date,
      amount,
      currency: 'USD',
      description: desc,
      displayName: cleanDescription(desc),
      pending: date >= addDays(today, -1) && amount < 0 && rand() < 0.6,
      categoryId: UNCATEGORIZED,
      categorySource: 'none',
      confidence: 0,
      excluded: false,
      reviewed: false,
      ...extra,
    });
  };

  const start = addDays(today, -days);
  for (let i = 0; i <= days; i++) {
    const date = addDays(start, i);
    const d = parseISODate(date);
    const dom = d.getDate();
    const dow = d.getDay();

    // Income: biweekly paycheck on Fridays + monthly interest
    if (dow === 5 && Math.floor(i / 7) % 2 === 0) add(date, 'ACME CORP PAYROLL PPD ID: 9876543210', 412_500, 'demo_checking');
    if (dom === 28) add(date, 'INTEREST PAYMENT', between(5200, 6100), 'demo_savings');

    // Fixed monthly bills
    if (dom === 1) add(date, 'MISSION HEIGHTS APARTMENTS RENT PAYMENT', -265_000, 'demo_checking');
    if (dom === 3) add(date, 'NETFLIX.COM 866-579-7172 CA', -1549);
    if (dom === 5) add(date, 'Spotify USA 877-778-1161', -1199);
    if (dom === 7) add(date, 'APPLE.COM/BILL 866-712-7753 CA', -299);
    if (dom === 9) add(date, 'EQUINOX #142 SAN FRANCISCO CA', -24_500);
    if (dom === 12) add(date, 'PGANDE WEB ONLINE PAYMENT', -between(8200, 13_400), 'demo_checking');
    if (dom === 15) add(date, 'COMCAST CALIFORNIA 800-COMCAST', -8999, 'demo_checking');
    if (dom === 18) add(date, 'GEICO *AUTO 800-841-3000 DC', -13_812, 'demo_checking');
    if (dom === 20) add(date, 'OPENAI *CHATGPT SUBSCR', -2000);
    if (dom === 22) add(date, 'T-MOBILE AUTO PAY', -9000, 'demo_checking');
    if (dom === 25) {
      add(date, 'PAYMENT THANK YOU - WEB', between(180_000, 260_000), 'demo_card');
      add(date, 'CHASE CREDIT CRD AUTOPAY PPD', -between(180_000, 260_000), 'demo_checking');
    }
    if (dom === 26) add(date, 'ROBINHOOD DES:FUNDS ID:XXXX', -50_000, 'demo_checking');

    // Variable everyday spending
    if (dow !== 0 && rand() < 0.62) add(date, pick(COFFEE.desc), -between(COFFEE.min, COFFEE.max));
    if (dow === 0 || dow === 3 || rand() < 0.12) add(date, pick(GROCERY.desc), -between(GROCERY.min, GROCERY.max));
    if (rand() < (dow >= 4 ? 0.65 : 0.32)) add(date, pick(DINING.desc), -between(DINING.min, DINING.max));
    if (rand() < 0.3) add(date, pick(TRANSPORT.desc), -between(TRANSPORT.min, TRANSPORT.max));
    if (rand() < 0.16) add(date, pick(SHOPPING.desc), -between(SHOPPING.min, SHOPPING.max));
    if (dow >= 5 && rand() < 0.28) add(date, pick(FUN.desc), -between(FUN.min, FUN.max));
    if (rand() < 0.08) add(date, pick(GAS.desc), -between(GAS.min, GAS.max));
    if (rand() < 0.07) add(date, `VENMO PAYMENT ${1000000000 + Math.floor(rand() * 8e9)}`, -between(1500, 6000), 'demo_checking');
    if (rand() < 0.04) add(date, 'WALGREENS #3021 SAN FRANCISCO CA', -between(900, 4200));
    if (rand() < 0.025) add(date, 'NOPA SALON SAN FRANCISCO CA', -between(6500, 12_000));
    if (rand() < 0.02) add(date, 'CHEWY.COM 800-672-4399', -between(3200, 8900));
  }

  // A trip and a refund to make things interesting.
  add(addDays(today, -40), 'DELTA AIR 0062345678912', -48_640);
  add(addDays(today, -21), 'AIRBNB * HMQ8ZP2KXM', -61_200);
  add(addDays(today, -9), 'AMZN Mktp US REFUND*7Y2', 4_599);

  return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
