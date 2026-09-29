const { body } = require('express-validator');

const initiatePaymentValidator = [
  body('bookingId').isMongoId().withMessage('Invalid booking id'),
  body('async').optional().isBoolean().withMessage('async must be a boolean'),
];

const webhookValidator = [
  body('eventId').trim().notEmpty().withMessage('eventId is required'),
  body('providerTransactionId').trim().notEmpty().withMessage('providerTransactionId is required'),
  body('status').isIn(['SUCCESS', 'FAILED']).withMessage('status must be SUCCESS or FAILED'),
];

module.exports = { initiatePaymentValidator, webhookValidator };
