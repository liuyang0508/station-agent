/**
 * SSRF Validator — Prevent Server-Side Request Forgery attacks
 *
 * Blocks requests to:
 * - Private IP ranges (10.x, 172.16-31.x, 192.168.x)
 * - Loopback addresses (127.x)
 * - Link-local addresses (169.254.x)
 * - IPv6 equivalents (::1, fc00::/7, fe80::/10)
 * - Hostnames resolving to private IPs
 */

const PRIVATE_IP_PATTERNS = [
  // IPv4 private ranges
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./,  // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^127\./,                         // 127.0.0.0/8 (loopback)
  /^169\.254\./,                    // 169.254.0.0/16 (link-local)
  /^224\./,                         // 224.0.0.0/4 (multicast)
  /^240\./,                         // 240.0.0.0/4 (reserved)

  // IPv4 broadcast
  /^255\.255\.255\.255$/,           // Broadcast

  // Loopback variants
  /^localhost$/i,
  /^::1$/i,
  /^0\.0\.0\.0$/,
];

const PRIVATE_IP_REGEXES = [
  /^(::1|::|0\.0\.0\.0)$/,
  /^(fc00:|fd00:|fe80:|ff00:)/i,
  /^(127\.)/,
  /^(10\.)/,
  /^(172\.(1[6-9]|2\d|3[01])\.)/,
  /^(192\.168\.)/,
  /^(169\.254\.)/,
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',       // GCP metadata
  'metadata.internal',
  'kubernetes.default',               // K8s service
  '169.254.169.254',                // AWS/GCP/Azure metadata endpoint
  'metadata.azure.com',
]);

const DANGEROUS_PATTERNS = [
  // IPv6 with embedded IPv4
  /::ffff:(?:10\.\d+|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/i,
  // Octal/hex encoding attempts
  /0\d{2,}/,                       // Invalid octal
  /0x[0-9a-f]+/i,                 // Hexadecimal
  // URL encoding bypass
  /%30|%00/,
  // @ sign abuse (user:password@host)
  /@[\d.]+@/,
];

/**
 * Check if a hostname/IP is in a private range
 */
function isPrivateHost(host) {
  if (!host) return false;

  const lowerHost = host.toLowerCase();

  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.has(lowerHost)) {
    return true;
  }

  // Check IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(lowerHost)) {
      return true;
    }
  }

  // Check regex patterns
  for (const regex of PRIVATE_IP_REGEXES) {
    if (regex.test(lowerHost)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract hostname from URL
 */
function extractHostname(urlString) {
  try {
    // Handle URLs without protocol
    let url;
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      url = new URL(`https://${urlString}`);
    } else {
      url = new URL(urlString);
    }
    return url.hostname;
  } catch {
    return null;
  }
}

/**
 * Validate a URL for SSRF vulnerabilities
 * @param {string} urlString - The URL to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.allowInternal - Allow internal network requests (default: false)
 * @param {string[]} options.allowedDomains - List of allowed domains (optional)
 * @returns {Object} { allowed: boolean, reason?: string }
 */
export function validateUrl(urlString, options = {}) {
  const { allowInternal = false, allowedDomains = [] } = options;

  if (!urlString || typeof urlString !== 'string') {
    return { allowed: false, reason: 'URL is required' };
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(urlString)) {
      return { allowed: false, reason: `URL contains dangerous pattern: ${pattern}` };
    }
  }

  let hostname;
  try {
    hostname = extractHostname(urlString);
  } catch {
    return { allowed: false, reason: 'Invalid URL format' };
  }

  if (!hostname) {
    return { allowed: false, reason: 'Could not extract hostname from URL' };
  }

  // Check if hostname is private
  if (isPrivateHost(hostname)) {
    return { allowed: false, reason: `Hostname resolves to private IP: ${hostname}` };
  }

  // Check allowed domains list (if provided)
  if (allowedDomains.length > 0) {
    const lowerHostname = hostname.toLowerCase();
    const isAllowed = allowedDomains.some(domain => {
      const lowerDomain = domain.toLowerCase();
      return lowerHostname === lowerDomain || lowerHostname.endsWith('.' + lowerDomain);
    });

    if (!isAllowed) {
      return { allowed: false, reason: `Hostname not in allowed domains: ${hostname}` };
    }
  }

  // For internal services, require explicit allowInternal=true
  if (!allowInternal) {
    // Additional check: if URL points to common internal service ports
    try {
      const url = new URL(urlString.startsWith('http') ? urlString : `https://${urlString}`);
      const port = url.port;
      const dangerousPorts = ['22', '23', '25', '3306', '5432', '27017', '6379', '11211'];
      if (port && dangerousPorts.includes(port)) {
        return { allowed: false, reason: `URL targets dangerous port: ${port}` };
      }
    } catch {
      // Ignore URL parsing errors here
    }
  }

  return { allowed: true };
}

/**
 * Validate a fetch request options object
 * Ensures the URL is safe before making the request
 */
export function validateFetchOptions(fetchOptions, options = {}) {
  if (!fetchOptions || typeof fetchOptions !== 'object') {
    return { allowed: false, reason: 'Fetch options must be an object' };
  }

  const url = fetchOptions.url || fetchOptions.href;
  if (!url) {
    return { allowed: false, reason: 'No URL in fetch options' };
  }

  return validateUrl(url, options);
}

/**
 * Safe fetch wrapper with SSRF validation
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {Object} ssrfOptions - SSRF validation options
 * @returns {Promise<Response>} - Fetch response
 * @throws {Error} - If URL is blocked
 */
export async function safeFetch(url, options = {}, ssrfOptions = {}) {
  const validation = validateUrl(url, ssrfOptions);
  if (!validation.allowed) {
    throw new Error(`SSRF validation failed: ${validation.reason}`);
  }

  return fetch(url, options);
}
