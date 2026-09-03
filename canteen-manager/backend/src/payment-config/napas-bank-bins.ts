// Hard-coded NAPAS-247 member acquirer BINs (6-digit), keyed by BIN → short bank name. The
// configured canteen account's BIN must be a member of this set: BIN + account number fully
// determine where a visitor's transfer lands, so a free-form BIN field would let a typo (or a
// coerced admin) silently reroute every payment. A static allowlist is also air-gap friendly
// (no network BIN lookup). Extend this list when onboarding a new bank.
export const NAPAS_BANK_BINS: Readonly<Record<string, string>> = {
  '970400': 'SaigonBank',
  '970403': 'Sacombank',
  '970405': 'Agribank',
  '970406': 'DongA Bank',
  '970407': 'Techcombank',
  '970408': 'GPBank',
  '970409': 'BacA Bank',
  '970412': 'PVcomBank',
  '970414': 'Oceanbank',
  '970415': 'VietinBank',
  '970416': 'ACB',
  '970418': 'BIDV',
  '970419': 'NCB',
  '970421': 'VRB',
  '970422': 'MB Bank',
  '970423': 'TPBank',
  '970424': 'ShinhanBank',
  '970425': 'ABBANK',
  '970426': 'MSB',
  '970427': 'VietABank',
  '970428': 'NamA Bank',
  '970429': 'SCB',
  '970430': 'PGBank',
  '970431': 'Eximbank',
  '970432': 'VPBank',
  '970433': 'VietBank',
  '970434': 'Indovina Bank',
  '970436': 'Vietcombank',
  '970437': 'HDBank',
  '970438': 'BaoViet Bank',
  '970439': 'PublicBank',
  '970440': 'SeABank',
  '970441': 'VIB',
  '970442': 'HongLeong Bank',
  '970443': 'SHB',
  '970444': 'CBBank',
  '970446': 'COOPBANK',
  '970448': 'OCB',
  '970449': 'LPBank',
  '970452': 'KienLongBank',
  '970454': 'BVBank',
  '970455': 'IBK Bank',
  '970457': 'Woori Bank',
  '970458': 'UnitedOverseas Bank',
  '970462': 'KookminBank',
  '970463': 'Standard Chartered',
  '970464': 'CIMB Bank',
};

export function isAllowedBankBin(bin: string): boolean {
  return Object.prototype.hasOwnProperty.call(NAPAS_BANK_BINS, bin);
}
