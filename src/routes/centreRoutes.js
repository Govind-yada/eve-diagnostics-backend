const express = require('express');
const {
  createCentre, listCentres, getCentre, updateCentre, deleteCentre,
  addTestToCentre, listTestsForCentre, updateTest, deleteTest,
} = require('../controllers/centreController');
const {
  createCentreValidator, createTestValidator, centreIdParamValidator,
  updateCentreValidator, testParamsValidator, updateTestValidator,
} = require('../validators/centreValidators');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/', listCentres);
router.post('/', protect, authorize('admin'), createCentreValidator, validate, createCentre);

router.get('/:id', getCentre);
router.patch('/:id', protect, authorize('admin'), updateCentreValidator, validate, updateCentre);
router.delete('/:id', protect, authorize('admin'), centreIdParamValidator, validate, deleteCentre);

router.get('/:centreId/tests', listTestsForCentre);
router.post('/:centreId/tests', protect, authorize('admin'), createTestValidator, validate, addTestToCentre);

router.patch('/:centreId/tests/:testId', protect, authorize('admin'), updateTestValidator, validate, updateTest);
router.delete('/:centreId/tests/:testId', protect, authorize('admin'), testParamsValidator, validate, deleteTest);

module.exports = router;
