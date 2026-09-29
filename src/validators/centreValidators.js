const { body, param } = require('express-validator');

const createCentreValidator = [
  body('name').trim().notEmpty().withMessage('Centre name is required'),
  body('location.address').trim().notEmpty().withMessage('Address is required'),
  body('location.city').trim().notEmpty().withMessage('City is required'),
];

const createTestValidator = [
  param('centreId').isMongoId().withMessage('Invalid centre id'),
  body('name').trim().notEmpty().withMessage('Test name is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
];

const centreIdParamValidator = [param('id').isMongoId().withMessage('Invalid centre id')];

const updateCentreValidator = [
  ...centreIdParamValidator,
  body('name').optional().trim().notEmpty().withMessage('Centre name cannot be empty'),
  body('location.address').optional().trim().notEmpty().withMessage('Address cannot be empty'),
  body('location.city').optional().trim().notEmpty().withMessage('City cannot be empty'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
];

const testParamsValidator = [
  param('centreId').isMongoId().withMessage('Invalid centre id'),
  param('testId').isMongoId().withMessage('Invalid test id'),
];

const updateTestValidator = [
  ...testParamsValidator,
  body('name').optional().trim().notEmpty().withMessage('Test name cannot be empty'),
  body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
];

module.exports = {
  createCentreValidator, createTestValidator,
  centreIdParamValidator, updateCentreValidator, testParamsValidator, updateTestValidator,
};
