const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

// 404 handler for unmatched routes.
function notFound(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// Normalizes known Mongoose errors into ApiError-shaped responses, then
// sends a consistent JSON error envelope for everything else.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  let error = err;

  if (err.name === 'CastError') {
    error = new ApiError(400, `Invalid value for field "${err.path}": ${err.value}`);
  } else if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    error = new ApiError(409, `Duplicate value for unique field "${field}"`);
  } else if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => e.message);
    error = new ApiError(400, 'Validation failed', details);
  } else if (!(err instanceof ApiError)) {
    error = new ApiError(500, err.message || 'Internal server error');
  }

  if (error.statusCode >= 500) {
    logger.error({ err }, 'Unhandled server error');
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  });
}

module.exports = { notFound, errorHandler };
