class ApiError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   * @param {any} [details] extra context (validation errors, etc.)
   */
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
