class ProviderError extends Error {
  /**
   * @param {string} code rate_limited|auth|network|empty|bad_request|upstream
   * @param {string} message
   * @param {{ status?: number, retryAfterSec?: number }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = extra.status;
    this.retryAfterSec = extra.retryAfterSec;
  }
}

module.exports = { ProviderError };
