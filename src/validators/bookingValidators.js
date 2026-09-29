const { body, param } = require('express-validator');

const createBookingValidator = [
  body('testId').isMongoId().withMessage('Invalid test id'),
  body('appointmentDate')
    .isISO8601()
    .withMessage('appointmentDate must be a valid ISO date')
    .custom((value) => new Date(value).getTime() > Date.now())
    .withMessage('appointmentDate must be in the future'),
];

const bookingIdParamValidator = [param('id').isMongoId().withMessage('Invalid booking id')];

module.exports = { createBookingValidator, bookingIdParamValidator };
