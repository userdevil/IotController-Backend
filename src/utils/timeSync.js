/**
 * IST (Indian Standard Time) clock-sync response builder.
 *
 * The firmware's MCP7940 RTC requires the response body to contain:
 *   >$IST=YYYYMMDDHHmmss#
 *
 * Full response format:
 *   "Packet Inserted >$IST=20261120193000#"
 */

/**
 * Build the IST time-sync acknowledgment string.
 * @param {Date} [date=new Date()] - Base date (defaults to now)
 * @returns {string} e.g. "Packet Inserted >$IST=20261120193000#"
 */
export function buildIstResponse(date = new Date()) {
  // IST = UTC + 5 hours 30 minutes
  const IST_OFFSET_MS = 330 * 60 * 1000;
  const ist = new Date(date.getTime() + IST_OFFSET_MS);

  const y  = ist.getUTCFullYear();
  const m  = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d  = String(ist.getUTCDate()).padStart(2, '0');
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  const ss = String(ist.getUTCSeconds()).padStart(2, '0');

  return `Packet Inserted >$IST=${y}${m}${d}${hh}${mm}${ss}#`;
}
