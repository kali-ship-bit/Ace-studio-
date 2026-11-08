/**
 * Country dial codes for the signup phone picker (Phase A).
 *
 * Nigeria (+234) first, then the rest alphabetically by country name.
 * Client-safe: no secrets, safe to import from React components.
 * A dial code is only accepted by the server when it is on this list
 * (see security/validation.ts).
 */

export interface CountryDialCode {
  /** ISO country code, e.g. "NG". */
  code: string;
  /** Display name. */
  name: string;
  /** Dial code with the leading +, e.g. "+234". */
  dialCode: string;
}

export const COUNTRIES: CountryDialCode[] = [
  { code: "NG", name: "Nigeria", dialCode: "+234" },
  { code: "GH", name: "Ghana", dialCode: "+233" },
  { code: "KE", name: "Kenya", dialCode: "+254" },
  { code: "ZA", name: "South Africa", dialCode: "+27" },
  { code: "EG", name: "Egypt", dialCode: "+20" },
  { code: "ET", name: "Ethiopia", dialCode: "+251" },
  { code: "UG", name: "Uganda", dialCode: "+256" },
  { code: "TZ", name: "Tanzania", dialCode: "+255" },
  { code: "CM", name: "Cameroon", dialCode: "+237" },
  { code: "CI", name: "Côte d’Ivoire", dialCode: "+225" },
  { code: "SN", name: "Senegal", dialCode: "+221" },
  { code: "MA", name: "Morocco", dialCode: "+212" },
  { code: "DZ", name: "Algeria", dialCode: "+213" },
  { code: "AO", name: "Angola", dialCode: "+244" },
  { code: "ZM", name: "Zambia", dialCode: "+260" },
  { code: "ZW", name: "Zimbabwe", dialCode: "+263" },
  // The rest of Africa, alphabetically — West Africa first (the app's
  // neighbours: Benin, Togo, Niger, Chad, Mali, Burkina Faso, Guinea,
  // Sierra Leone, Liberia, Gambia, Guinea-Bissau, Cabo Verde,
  // Mauritania), then the other regions.
  { code: "BJ", name: "Benin", dialCode: "+229" },
  { code: "BF", name: "Burkina Faso", dialCode: "+226" },
  { code: "CV", name: "Cabo Verde", dialCode: "+238" },
  { code: "TD", name: "Chad", dialCode: "+235" },
  { code: "GM", name: "Gambia", dialCode: "+220" },
  { code: "GN", name: "Guinea", dialCode: "+224" },
  { code: "GW", name: "Guinea-Bissau", dialCode: "+245" },
  { code: "LR", name: "Liberia", dialCode: "+231" },
  { code: "ML", name: "Mali", dialCode: "+223" },
  { code: "MR", name: "Mauritania", dialCode: "+222" },
  { code: "NE", name: "Niger", dialCode: "+227" },
  { code: "SL", name: "Sierra Leone", dialCode: "+232" },
  { code: "TG", name: "Togo", dialCode: "+228" },
  { code: "BW", name: "Botswana", dialCode: "+267" },
  { code: "BI", name: "Burundi", dialCode: "+257" },
  { code: "CF", name: "Central African Republic", dialCode: "+236" },
  { code: "CG", name: "Congo", dialCode: "+242" },
  { code: "CD", name: "DR Congo", dialCode: "+243" },
  { code: "DJ", name: "Djibouti", dialCode: "+253" },
  { code: "ER", name: "Eritrea", dialCode: "+291" },
  { code: "GA", name: "Gabon", dialCode: "+241" },
  { code: "GQ", name: "Equatorial Guinea", dialCode: "+240" },
  { code: "SZ", name: "Eswatini", dialCode: "+268" },
  { code: "LS", name: "Lesotho", dialCode: "+266" },
  { code: "LY", name: "Libya", dialCode: "+218" },
  { code: "MG", name: "Madagascar", dialCode: "+261" },
  { code: "MW", name: "Malawi", dialCode: "+265" },
  { code: "MU", name: "Mauritius", dialCode: "+230" },
  { code: "MZ", name: "Mozambique", dialCode: "+258" },
  { code: "NA", name: "Namibia", dialCode: "+264" },
  { code: "RW", name: "Rwanda", dialCode: "+250" },
  { code: "ST", name: "São Tomé and Príncipe", dialCode: "+239" },
  { code: "SC", name: "Seychelles", dialCode: "+248" },
  { code: "SO", name: "Somalia", dialCode: "+252" },
  { code: "SS", name: "South Sudan", dialCode: "+211" },
  { code: "SD", name: "Sudan", dialCode: "+249" },
  { code: "TN", name: "Tunisia", dialCode: "+216" },
  { code: "GB", name: "United Kingdom", dialCode: "+44" },
  { code: "IE", name: "Ireland", dialCode: "+353" },
  { code: "US", name: "United States", dialCode: "+1" },
  { code: "CA", name: "Canada", dialCode: "+1" },
  { code: "IN", name: "India", dialCode: "+91" },
  { code: "PK", name: "Pakistan", dialCode: "+92" },
  { code: "BD", name: "Bangladesh", dialCode: "+880" },
  { code: "PH", name: "Philippines", dialCode: "+63" },
  { code: "ID", name: "Indonesia", dialCode: "+62" },
  { code: "MY", name: "Malaysia", dialCode: "+60" },
  { code: "SG", name: "Singapore", dialCode: "+65" },
  { code: "AE", name: "United Arab Emirates", dialCode: "+971" },
  { code: "SA", name: "Saudi Arabia", dialCode: "+966" },
  { code: "QA", name: "Qatar", dialCode: "+974" },
  { code: "TR", name: "Turkey", dialCode: "+90" },
  { code: "DE", name: "Germany", dialCode: "+49" },
  { code: "FR", name: "France", dialCode: "+33" },
  { code: "ES", name: "Spain", dialCode: "+34" },
  { code: "IT", name: "Italy", dialCode: "+39" },
  { code: "NL", name: "Netherlands", dialCode: "+31" },
  { code: "SE", name: "Sweden", dialCode: "+46" },
  { code: "NO", name: "Norway", dialCode: "+47" },
  { code: "BR", name: "Brazil", dialCode: "+55" },
  { code: "MX", name: "Mexico", dialCode: "+52" },
  { code: "AR", name: "Argentina", dialCode: "+54" },
  { code: "AU", name: "Australia", dialCode: "+61" },
  { code: "NZ", name: "New Zealand", dialCode: "+64" },
  { code: "JP", name: "Japan", dialCode: "+81" },
  { code: "KR", name: "South Korea", dialCode: "+82" },
  { code: "CN", name: "China", dialCode: "+86" },
  { code: "RU", name: "Russia", dialCode: "+7" },
  { code: "UA", name: "Ukraine", dialCode: "+380" },
  { code: "PL", name: "Poland", dialCode: "+48" },
];
