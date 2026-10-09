/**
 * Merchant name cleaning + a built-in knowledge base of common US merchants.
 *
 * Bank descriptors look like "SQ *BLUE BOTTLE COFFE 0123  OAKLAND CA" or
 * "AMZN Mktp US*2K4L19P02". We turn those into "Blue Bottle Coffe" / "Amazon"
 * and a stable lowercase key used for learning and rules.
 */

/** Payment-processor / card-network prefixes that precede the real merchant. */
const PREFIXES: RegExp[] = [
  /^(?:POS|DBT|DEBIT|CHECKCARD|CHECK CARD|ACH)\s+(?:PURCHASE|DEBIT|CREDIT|WITHDRAWAL|PMT|PAYMENT)?\s*(?:-\s*)?/,
  /^(?:DEBIT CARD PURCHASE|PURCHASE AUTHORIZED ON \d{1,2}\/\d{1,2}|RECURRING PAYMENT AUTHORIZED ON \d{1,2}\/\d{1,2}|PURCHASE)\s*/,
  /^CHECKCARD\s+\d{4}\s*/,
  /^(?:SQ|TST|SP|PP|PAYPAL|DD|IC|BT|PY|TM|FSP|SPO|PAR|CKE|SMK|LS|GOOGLE|APL|EB|OLO|WPY|ZSK)\s?\*\s*/,
  /^(?:IN|WWW)\s*\*\s*/,
];

const NOISE: RegExp[] = [
  /\b(?:X{2,}|\*{2,})\d{2,}\b/g, // masked card numbers
  /#\s?\d+/g, // store numbers
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, // dates
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // phone numbers
  /\bREF\s*#?\s*\w+/g,
  /\b(?:ID|CONF|AUTH|TRACE)[:#]?\s*\w*\d\w*/g,
  /\b[A-Z]*\d[A-Z\d]{5,}\b/g, // reference codes like 2K4L19P02
  /\b\d{3,}\b/g, // long bare numbers
];

const STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '),
);
const CITY_PREFIXES = new Set(['SAN', 'LOS', 'NEW', 'SANTA', 'ST', 'SAINT', 'FORT', 'FT', 'LAS', 'EL', 'PALO', 'MOUNTAIN', 'SALT', 'LAKE', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'PORT', 'LONG', 'BEVERLY', 'DALY', 'REDWOOD', 'MENLO', 'CULVER']);
const TRAILING_NOISE = new Set(['STORE', 'STORES', 'INC', 'LLC', 'CORP', 'LTD', 'CO', 'USA', 'US', 'ONLINE', 'PURCHASE', 'PAYMENT', 'POS', 'DEBIT', 'THE']);
const KEEP_UPPER = new Set(['CVS', 'AMC', 'H&M', 'IKEA', 'USPS', 'UPS', 'DMV', 'ATM', 'TJ', 'BP', 'AT&T', 'HBO', 'KFC', 'IHOP', 'REI', 'BJ', 'DSW', 'NYC', 'LA', 'SF', 'PG&E', 'IRS', 'YMCA', 'ACH']);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => {
      if (!w) return w;
      const up = w.toUpperCase();
      if (KEEP_UPPER.has(up)) return up;
      return w
        .split(/([-&.])/)
        .map((part) => (part.length > 0 && /[a-z]/.test(part[0]!) ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join('');
    })
    .join(' ');
}

/** Clean a raw bank descriptor into a human-friendly merchant name. */
export function cleanDescription(raw: string): string {
  let s = raw.toUpperCase().trim();

  // Fixed-width descriptors separate merchant and location with runs of spaces.
  const firstGap = s.search(/\s{3,}/);
  if (firstGap > 3) s = s.slice(0, firstGap);

  for (let pass = 0; pass < 2; pass++) {
    for (const p of PREFIXES) s = s.replace(p, '');
  }
  for (const n of NOISE) s = s.replace(n, ' ');
  s = s.replace(/\.COM\b/g, '').replace(/\bHTTPS?:\/\/\S+/g, '');
  s = s.replace(/[*_|~"]+/g, ' ').replace(/\s+/g, ' ').trim();

  let words = s.split(' ').filter(Boolean);
  // Trailing "CITY ST"
  if (words.length >= 3 && STATES.has(words[words.length - 1]!)) {
    words = words.slice(0, -2);
    while (words.length >= 2 && CITY_PREFIXES.has(words[words.length - 1]!)) words.pop();
  } else if (words.length >= 2 && STATES.has(words[words.length - 1]!) && words[words.length - 1]!.length === 2) {
    words = words.slice(0, -1);
  }
  while (words.length > 1 && (TRAILING_NOISE.has(words[words.length - 1]!) || /^\d+$/.test(words[words.length - 1]!))) words.pop();
  while (words.length > 1 && /^[-&.,]+$/.test(words[words.length - 1]!)) words.pop();

  const cleaned = words.join(' ').replace(/[\s,.-]+$/, '').trim();
  if (!cleaned) return titleCase(raw.trim().replace(/\s+/g, ' ')).slice(0, 40);
  return titleCase(cleaned);
}

/** Stable key for a merchant used for learning and rule matching. */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MerchantMatch {
  name: string;
  categoryId: string;
}

/**
 * Known merchants. An empty name means the pattern identifies a *kind* of
 * merchant (any gym, any airline) — the cleaned descriptor stays the name.
 * Order matters: more specific patterns come first
 * (e.g. "UBER EATS" before "UBER"). Patterns run against the uppercase raw
 * descriptor and the provider's merchant name.
 */
const KB: Array<[RegExp, string, string]> = [
  // Food delivery before rideshare
  [/\bUBER\s*\*?\s*EATS\b|\bUBEREATS\b/, 'Uber Eats', 'dining'],
  [/\bDOORDASH\b|\bDD \*DOORDASH/, 'DoorDash', 'dining'],
  [/\bGRUBHUB\b/, 'Grubhub', 'dining'],
  [/\bPOSTMATES\b/, 'Postmates', 'dining'],
  [/\bCAVIAR\b/, 'Caviar', 'dining'],
  [/\bINSTACART\b/, 'Instacart', 'groceries'],
  // Transport
  [/\bUBER\b/, 'Uber', 'transport'],
  [/\bLYFT\b/, 'Lyft', 'transport'],
  [/\bCLIPPER\b|\bBART\b|\bMTA\b|\bMETRO ?CARD\b|\bVENTRA\b|\bSEPTA\b|\bWMATA\b|\bCALTRAIN\b/, '', 'transport'],
  [/\bFASTRAK\b|\bE-?Z ?PASS\b|\bSUNPASS\b|\bTOLL\b/, '', 'transport'],
  [/\bPARKMOBILE\b|\bSPOTHERO\b|\bPAYBYPHONE\b|\bPARKING\b|\bLAZ PARKING\b/, '', 'transport'],
  [/\bLIME\b\*?|\bBIRD APP\b|\bCITI ?BIKE\b|\bLYFT BIKES?\b/, '', 'transport'],
  [/\bTESLA SUPERCHARG|\bCHARGEPOINT\b|\bEVGO\b|\bELECTRIFY AMERICA\b/, '', 'gas'],
  // Gas
  [/\bSHELL\b/, 'Shell', 'gas'],
  [/\bCHEVRON\b/, 'Chevron', 'gas'],
  [/\bEXXON\b|\bMOBIL\b/, 'ExxonMobil', 'gas'],
  [/\bARCO\b/, 'ARCO', 'gas'],
  [/\b76\b.*\b(?:GAS|FUEL)\b|\bUNION 76\b/, '76', 'gas'],
  [/\bSUNOCO\b/, 'Sunoco', 'gas'],
  [/\bVALERO\b/, 'Valero', 'gas'],
  [/\bCIRCLE K\b/, 'Circle K', 'gas'],
  [/\bWAWA\b/, 'Wawa', 'gas'],
  [/\bSPEEDWAY\b/, 'Speedway', 'gas'],
  [/\bMARATHON PETRO/, 'Marathon', 'gas'],
  [/\bBP#|\bBP\b/, 'BP', 'gas'],
  [/\bCOSTCO GAS\b/, 'Costco Gas', 'gas'],
  // Coffee
  [/\bSTARBUCKS\b/, 'Starbucks', 'coffee'],
  [/\bDUNKIN\b/, "Dunkin'", 'coffee'],
  [/\bBLUE BOTTLE\b/, 'Blue Bottle Coffee', 'coffee'],
  [/\bPEET'?S\b/, "Peet's Coffee", 'coffee'],
  [/\bPHILZ\b/, 'Philz Coffee', 'coffee'],
  [/\bDUTCH BROS\b/, 'Dutch Bros', 'coffee'],
  [/\bTIM HORTONS\b/, 'Tim Hortons', 'coffee'],
  [/\bCOFFEE BEAN\b/, 'Coffee Bean & Tea Leaf', 'coffee'],
  [/\bINTELLIGENTSIA\b|\bSTUMPTOWN\b|\bLA COLOMBE\b|\bVERVE\b/, '', 'coffee'],
  // Groceries
  [/\bWHOLE ?FOODS\b|\bWHOLEFDS\b|\bWFM\b/, 'Whole Foods', 'groceries'],
  [/\bTRADER JOE/, "Trader Joe's", 'groceries'],
  [/\bSAFEWAY\b/, 'Safeway', 'groceries'],
  [/\bKROGER\b/, 'Kroger', 'groceries'],
  [/\bALDI\b/, 'Aldi', 'groceries'],
  [/\bPUBLIX\b/, 'Publix', 'groceries'],
  [/\bWEGMANS\b/, 'Wegmans', 'groceries'],
  [/\bH-?E-?B\b/, 'H-E-B', 'groceries'],
  [/\bSPROUTS\b/, 'Sprouts', 'groceries'],
  [/\bRALPHS\b/, 'Ralphs', 'groceries'],
  [/\bVONS\b/, 'Vons', 'groceries'],
  [/\bALBERTSONS\b/, 'Albertsons', 'groceries'],
  [/\bFOOD ?LION\b/, 'Food Lion', 'groceries'],
  [/\bGIANT EAGLE\b|\bGIANT FOOD\b/, 'Giant', 'groceries'],
  [/\bSTOP ?& ?SHOP\b/, 'Stop & Shop', 'groceries'],
  [/\bMEIJER\b/, 'Meijer', 'groceries'],
  [/\bHARRIS TEETER\b/, 'Harris Teeter', 'groceries'],
  [/\bH ?MART\b/, 'H Mart', 'groceries'],
  [/\b99 RANCH\b/, '99 Ranch', 'groceries'],
  [/\bGROCERY OUTLET\b/, 'Grocery Outlet', 'groceries'],
  [/\bFRESH ?DIRECT\b/, 'FreshDirect', 'groceries'],
  [/\bCOSTCO\b/, 'Costco', 'groceries'],
  [/\bSAMS ?CLUB\b|\bSAM'S CLUB\b/, "Sam's Club", 'groceries'],
  // Dining
  [/\bMCDONALD'?S\b/, "McDonald's", 'dining'],
  [/\bCHIPOTLE\b/, 'Chipotle', 'dining'],
  [/\bSWEETGREEN\b/, 'Sweetgreen', 'dining'],
  [/\bCHICK-?FIL-?A\b/, 'Chick-fil-A', 'dining'],
  [/\bTACO BELL\b/, 'Taco Bell', 'dining'],
  [/\bIN-?N-?OUT\b/, 'In-N-Out', 'dining'],
  [/\bSHAKE SHACK\b/, 'Shake Shack', 'dining'],
  [/\bPANERA\b/, 'Panera Bread', 'dining'],
  [/\bSUBWAY\b/, 'Subway', 'dining'],
  [/\bDOMINO'?S\b/, "Domino's", 'dining'],
  [/\bPIZZA HUT\b/, 'Pizza Hut', 'dining'],
  [/\bWENDY'?S\b/, "Wendy's", 'dining'],
  [/\bBURGER KING\b/, 'Burger King', 'dining'],
  [/\bFIVE GUYS\b/, 'Five Guys', 'dining'],
  [/\bPANDA EXPRESS\b/, 'Panda Express', 'dining'],
  [/\bCAVA\b/, 'CAVA', 'dining'],
  [/\bWINGSTOP\b/, 'Wingstop', 'dining'],
  [/\bJACK IN THE BOX\b/, 'Jack in the Box', 'dining'],
  [/\bOPENTABLE\b|\bRESY\b|\bTOCK\b/, '', 'dining'],
  // Shopping
  [/\bAMZN\b|\bAMAZON(?!\s*PRIME)(?!\s*WEB SERVICES)\b|\bAMAZON\.COM\b/, 'Amazon', 'shopping'],
  [/\bTARGET\b/, 'Target', 'shopping'],
  [/\bWAL-?MART\b|\bWM SUPERCENTER\b/, 'Walmart', 'shopping'],
  [/\bBEST ?BUY\b/, 'Best Buy', 'shopping'],
  [/\bAPPLE ?STORE\b|\bAPPLE\.COM\/US\b/, 'Apple Store', 'shopping'],
  [/\bIKEA\b/, 'IKEA', 'shopping'],
  [/\bHOME ?DEPOT\b/, 'Home Depot', 'shopping'],
  [/\bLOWE'?S\b/, "Lowe's", 'shopping'],
  [/\bETSY\b/, 'Etsy', 'shopping'],
  [/\bEBAY\b/, 'eBay', 'shopping'],
  [/\bUNIQLO\b/, 'Uniqlo', 'shopping'],
  [/\bZARA\b/, 'Zara', 'shopping'],
  [/\bH&M\b/, 'H&M', 'shopping'],
  [/\bNORDSTROM\b/, 'Nordstrom', 'shopping'],
  [/\bMACY'?S\b/, "Macy's", 'shopping'],
  [/\bTJ ?MAXX\b|\bMARSHALLS\b|\bHOMEGOODS\b/, '', 'shopping'],
  [/\bNIKE\b/, 'Nike', 'shopping'],
  [/\bREI\b/, 'REI', 'shopping'],
  [/\bSHEIN\b/, 'Shein', 'shopping'],
  [/\bTEMU\b/, 'Temu', 'shopping'],
  [/\bWAYFAIR\b/, 'Wayfair', 'shopping'],
  [/\bCVS\b/, 'CVS', 'health'],
  [/\bWALGREENS\b/, 'Walgreens', 'health'],
  [/\bRITE ?AID\b/, 'Rite Aid', 'health'],
  [/\bSEPHORA\b/, 'Sephora', 'personal'],
  [/\bULTA\b/, 'Ulta Beauty', 'personal'],
  [/\bGREAT CLIPS\b|\bSUPERCUTS\b/, '', 'personal'],
  // Subscriptions & digital
  [/\bNETFLIX\b/, 'Netflix', 'subscriptions'],
  [/\bSPOTIFY\b/, 'Spotify', 'subscriptions'],
  [/\bHULU\b/, 'Hulu', 'subscriptions'],
  [/\bDISNEY ?(?:PLUS|\+)\b|\bDISNEYPLUS\b/, 'Disney+', 'subscriptions'],
  [/\bHBO ?MAX\b|\bMAX\.COM\b/, 'Max', 'subscriptions'],
  [/\bYOUTUBE ?(?:PREMIUM|TV)?\b|\bGOOGLE \*YOUTUBE/, 'YouTube', 'subscriptions'],
  [/\bPARAMOUNT\+?\b/, 'Paramount+', 'subscriptions'],
  [/\bPEACOCK\b/, 'Peacock', 'subscriptions'],
  [/\bAPPLE\.COM\/BILL\b|\bAPL\*?ITUNES\b|\bITUNES\.COM\b|\bAPPLE ?(?:ONE|MUSIC|TV|ICLOUD)\b/, 'Apple Services', 'subscriptions'],
  [/\bAMAZON ?PRIME\b|\bPRIME VIDEO\b|\bAUDIBLE\b|\bKINDLE\b/, 'Amazon Prime', 'subscriptions'],
  [/\bGOOGLE ?(?:STORAGE|ONE|\*GOOGLE ONE)\b|\bGOOGLE \*(?:STORAGE|CLOUD)/, 'Google One', 'subscriptions'],
  [/\bDROPBOX\b/, 'Dropbox', 'subscriptions'],
  [/\bOPENAI\b|\bCHATGPT\b/, 'OpenAI', 'subscriptions'],
  [/\bANTHROPIC\b|\bCLAUDE\.AI\b/, 'Anthropic', 'subscriptions'],
  [/\bGITHUB\b/, 'GitHub', 'subscriptions'],
  [/\bNOTION\b/, 'Notion', 'subscriptions'],
  [/\bADOBE\b/, 'Adobe', 'subscriptions'],
  [/\bMICROSOFT\b|\bMSFT\b|\bXBOX\b/, 'Microsoft', 'subscriptions'],
  [/\bNYTIMES\b|\bNY TIMES\b|\bNEW YORK TIMES\b/, 'New York Times', 'subscriptions'],
  [/\bPATREON\b|\bSUBSTACK\b/, '', 'subscriptions'],
  [/\bDUOLINGO\b/, 'Duolingo', 'subscriptions'],
  [/\b1PASSWORD\b|\bBITWARDEN\b/, '', 'subscriptions'],
  [/\bAWS\b|\bAMAZON WEB SERVICES\b/, 'AWS', 'subscriptions'],
  // Entertainment
  [/\bAMC\b(?: THEATRES?)?|\bREGAL\b|\bCINEMARK\b|\bALAMO DRAFTHOUSE\b|\bFANDANGO\b/, '', 'entertainment'],
  [/\bTICKETMASTER\b|\bLIVE ?NATION\b|\bSTUBHUB\b|\bSEATGEEK\b|\bEVENTBRITE\b|\bAXS\b/, '', 'entertainment'],
  [/\bSTEAM(?:POWERED)?\b|\bSTEAMGAMES\b|\bPLAYSTATION\b|\bNINTENDO\b|\bEPIC GAMES\b/, '', 'entertainment'],
  // Fitness
  [/\bEQUINOX\b|\bPLANET FITNESS\b|\b24 HOUR FITNESS\b|\bLA FITNESS\b|\bCRUNCH\b|\bORANGETHEORY\b|\bSOULCYCLE\b|\bCLASSPASS\b|\bPELOTON\b|\bSTRAVA\b|\bBARRY'?S\b|\bYMCA\b/, '', 'fitness'],
  // Travel
  [/\bAIRBNB\b/, 'Airbnb', 'travel'],
  [/\bVRBO\b/, 'Vrbo', 'travel'],
  [/\bMARRIOTT\b|\bHILTON\b|\bHYATT\b|\bIHG\b|\bHOLIDAY INN\b|\bWESTIN\b|\bSHERATON\b|\bFOUR SEASONS\b/, '', 'travel'],
  [/\bEXPEDIA\b|\bBOOKING\.COM\b|\bHOTELS\.COM\b|\bKAYAK\b|\bPRICELINE\b/, '', 'travel'],
  [/\bDELTA AIR\b|\bUNITED AIR\b|\bAMERICAN AIR\b|\bSOUTHWEST AIR\b|\bSOUTHWES\b|\bJETBLUE\b|\bALASKA AIR\b|\bSPIRIT AIRL\b|\bFRONTIER AIRL\b|\bAIR CANADA\b|\bBRITISH AIRWAYS\b/, '', 'travel'],
  [/\bHERTZ\b|\bAVIS\b|\bENTERPRISE RENT\b|\bBUDGET RENT\b|\bTURO\b|\bSIXT\b/, '', 'travel'],
  [/\bAMTRAK\b/, 'Amtrak', 'travel'],
  [/\bTSA ?PRE\b|\bCLEAR ?ME\b|\bCLEARME\b/, '', 'travel'],
  // Bills & utilities
  [/\bPG&E\b|\bPGANDE\b|\bCON ?ED\b|\bDUKE ENERGY\b|\bSO(?:UTHERN)? CAL(?:IFORNIA)? EDISON\b|\bSCE\b|\bCOMED\b|\bXCEL ENERGY\b|\bDOMINION ENERGY\b|\bNATIONAL GRID\b|\bEVERSOURCE\b/, '', 'bills'],
  [/\bCOMCAST\b|\bXFINITY\b|\bSPECTRUM\b|\bCOX COMM\b|\bVERIZON\b|\bAT&T\b|\bATT\*|\bT-?MOBILE\b|\bMINT MOBILE\b|\bGOOGLE ?FI\b|\bSONIC\.NET\b|\bOPTIMUM\b|\bFRONTIER COMM\b|\bVISIBLE\b/, '', 'bills'],
  [/\bWATER (?:DEPT|DISTRICT|UTILITY|BILL)\b|\bWASTE MANAGEMENT\b|\bRECOLOGY\b|\bREPUBLIC SERVICES\b/, '', 'bills'],
  [/\bIRS\b|\bUSATAXPYMT\b|\bFRANCHISE TAX\b|\bDEPT OF REVENUE\b|\bDMV\b/, '', 'bills'],
  // Insurance
  [/\bGEICO\b|\bPROGRESSIVE\b|\bSTATE FARM\b|\bALLSTATE\b|\bLIBERTY MUTUAL\b|\bLEMONADE\b|\bUSAA (?:INS|P&C)\b|\bNATIONWIDE\b|\bFARMERS INS\b/, '', 'insurance'],
  // Housing
  [/\bAPARTMENTS?\b|\bPROPERTY MGMT\b|\bPROPERTY MANAGEMENT\b|\bAVALONBAY\b|\bEQUITY RESIDENTIAL\b|\bRENT PAYMENT\b|\bBILT\b.*\bRENT\b/, '', 'housing'],
  [/\bMORTGAGE\b|\bROCKET MORTGAGE\b|\bMR\.? COOPER\b|\bLOANCARE\b/, '', 'housing'],
  // Pets
  [/\bCHEWY\b|\bPETCO\b|\bPETSMART\b|\bROVER\.COM\b|\bBANFIELD\b/, '', 'pets'],
  // Education
  [/\bCOURSERA\b|\bUDEMY\b|\bMASTERCLASS\b|\bSKILLSHARE\b|\bBRILLIANT\b|\bTUITION\b|\bUNIVERSITY\b|\bCOLLEGE\b/, '', 'education'],
  // Giving
  [/\bGOFUNDME\b|\bRED CROSS\b|\bUNICEF\b|\bDONATION\b|\bCHARITY\b|\bWIKIMEDIA\b|\bACLU\b|\bDOCTORS WITHOUT\b/, '', 'gifts'],
  // Transfers & payments (must not count as spending)
  [/\bVENMO\b/, 'Venmo', 'transfer'],
  [/\bZELLE\b/, 'Zelle', 'transfer'],
  [/\bCASH ?APP\b|\bSQUARE CASH\b/, 'Cash App', 'transfer'],
  [/\bPAYPAL\b(?!\s*\*)/, 'PayPal', 'transfer'],
  [/\bAPPLE ?CASH\b/, 'Apple Cash', 'transfer'],
  [/\bAUTOPAY\b|\bPAYMENT,? THANK YOU\b|\bTHANK YOU FOR YOUR PAYMENT\b|\bONLINE PAYMENT\b|\bCREDIT CARD PAYMENT\b|\bCARD ?PMT\b|\bEPAY\b|\bAMEX EPAYMENT\b|\bCHASE CREDIT CRD\b|\bCAPITAL ONE (?:MOBILE )?PYMT\b|\bDISCOVER E-?PAYMENT\b|\bCITI AUTOPAY\b|\bAPPLECARD GSBANK\b/, '', 'transfer'],
  [/\bROBINHOOD\b|\bFIDELITY\b|\bVANGUARD\b|\bSCHWAB\b|\bWEALTHFRONT\b|\bBETTERMENT\b|\bCOINBASE\b|\bE\*?TRADE\b/, '', 'transfer'],
  [/\b(?:ONLINE |MOBILE |INTERNAL |ACCOUNT )?TRANSFER\b|\bXFER\b|\bTRNSFR\b/, '', 'transfer'],
  // Cash / fees / income
  [/\bATM\b|\bCASH WITHDRAWAL\b|\bWITHDRAWAL\b/, '', 'cash'],
  [/\bOVERDRAFT\b|\bNSF FEE\b|\bMONTHLY (?:SERVICE|MAINTENANCE) FEE\b|\bFOREIGN TRANSACTION FEE\b|\bLATE FEE\b|\bANNUAL FEE\b|\bINTEREST CHARGE\b|\bFINANCE CHARGE\b/, '', 'fees'],
  [/\bPAYROLL\b|\bDIRECT ?DEP(?:OSIT)?\b|\bSALARY\b|\bGUSTO\b|\bADP\b|\bPAYCHEX\b|\bRIPPLING\b|\bDEEL\b/, '', 'income'],
  [/\bINTEREST (?:PAID|EARNED|PAYMENT)\b|\bDIVIDEND\b/, '', 'income'],
  [/\bTAX REF(?:UN)?D\b|\bIRS TREAS\b/, '', 'income'],
];

/** Look up a well-known merchant from a descriptor and/or provider merchant name. */
export function lookupMerchant(description: string, merchantName?: string): MerchantMatch | undefined {
  const candidates = [merchantName, description].filter((v): v is string => !!v).map((v) => v.toUpperCase());
  for (const [re, name, categoryId] of KB) {
    for (const c of candidates) {
      if (re.test(c)) return { name, categoryId };
    }
  }
  return undefined;
}

/** Generic keyword heuristics for merchants we don't know by name. */
const HEURISTICS: Array<[RegExp, string]> = [
  [/\b(?:ELECTRIC|UTILIT(?:Y|IES)|POWER CO|GAS ?& ?ELEC|ENERGY|INTERNET|WIRELESS|BROADBAND|CABLE)\b/, 'bills'],
  [/\b(?:COFFEE|ESPRESSO|ROASTERS?|ROASTING|CAFE ?AU|BOBA|TEA ?HOUSE)\b/, 'coffee'],
  [/\b(?:RESTAURANT|GRILL|PIZZ(?:A|ERIA)|TAQUERIA|TACOS?|SUSHI|BURGERS?|KITCHEN|DINER|BISTRO|BBQ|BREWING|BREWERY|BAR ?&|TAVERN|PUB|RAMEN|PHO|THAI|NOODLE|CANTINA|BAKERY|DELI|EATERY|CAFE|BAGEL|DONUTS?|WINGS|CREAMERY|GELATO)\b/, 'dining'],
  [/\b(?:GROCERY|GROCERIES|SUPERMARKET|MARKET|FOODS|PRODUCE|BUTCHER|FARMERS)\b/, 'groceries'],
  [/\b(?:GAS STATION|FUEL|PETRO(?:LEUM)?|GASOLINE)\b/, 'gas'],
  [/\b(?:PHARMACY|DENTAL|DENTIST|MEDICAL|CLINIC|HOSPITAL|HEALTH|OPTOMETR|VISION|LABCORP|QUEST DIAG|THERAPY|URGENT CARE|PEDIATRIC)\b/, 'health'],
  [/\b(?:GYM|FITNESS|YOGA|PILATES|CLIMBING|BOULDER|CROSSFIT|CYCLE|ATHLETIC CLUB)\b/, 'fitness'],
  [/\b(?:HOTEL|MOTEL|INN|RESORT|HOSTEL|AIRLINES?|AIRWAYS|AIRPORT|LODGE)\b/, 'travel'],
  [/\b(?:PARKING|GARAGE|TRANSIT|TAXI|CAB|RAIL|FERRY|CAR WASH|AUTO REPAIR|JIFFY LUBE|SMOG)\b/, 'transport'],
  [/\b(?:SALON|BARBER|SPA|NAILS?|BEAUTY|COSMETIC|MASSAGE|WAXING)\b/, 'personal'],
  [/\b(?:VET(?:ERINARY)?|ANIMAL HOSP|PET)\b/, 'pets'],
  [/\b(?:INSURANCE|ASSURANCE)\b/, 'insurance'],
  [/\b(?:RENT|LEASING|HOA)\b/, 'housing'],
  [/\b(?:CINEMA|THEATRE|THEATER|MUSEUM|BOWLING|ARCADE|CONCERT|ZOO|AQUARIUM)\b/, 'entertainment'],
  [/\b(?:SCHOOL|ACADEMY|BOOKSTORE|TEXTBOOK)\b/, 'education'],
  [/\b(?:FLORIST|FLOWERS|GIFT)\b/, 'gifts'],
  [/\b(?:FEE|INTEREST CHG)\b/, 'fees'],
  [/\b(?:DEPOSIT|REFUND|REIMBURSEMENT|CASHBACK|CASH BACK|REWARD)\b/, 'income'],
];

export function heuristicCategory(description: string): string | undefined {
  const up = description.toUpperCase();
  for (const [re, cat] of HEURISTICS) if (re.test(up)) return cat;
  return undefined;
}
