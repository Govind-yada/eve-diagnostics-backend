const express = require('express');
const {
  createBooking,
  listMyBookings,
  getBooking,
  cancelBooking,
} = require('../controllers/bookingController');
const { createBookingValidator, bookingIdParamValidator } = require('../validators/bookingValidators');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.post('/', createBookingValidator, validate, createBooking);

router.get('/me', listMyBookings);

router.get('/:id', bookingIdParamValidator, validate, getBooking);

router.patch('/:id/cancel', bookingIdParamValidator, validate, cancelBooking);

module.exports = router;
