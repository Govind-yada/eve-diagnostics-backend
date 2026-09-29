const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Booking = require('../models/Booking');
const DiagnosticTest = require('../models/DiagnosticTest');

// POST /api/bookings
const createBooking = asyncHandler(async (req, res) => {
  const { testId, appointmentDate } = req.body;

  const test = await DiagnosticTest.findById(testId);
  if (!test || !test.isActive) {
    throw new ApiError(404, 'Diagnostic test not found');
  }

  const booking = await Booking.create({
    user: req.user._id,
    test: test._id,
    centre: test.centre,
    appointmentDate,
    amount: test.price, // snapshot price at booking time
    status: Booking.STATUS.PENDING,
  });

  res.status(201).json({ success: true, data: { booking } });
});

// GET /api/bookings/me?page=1&limit=10&status=PENDING
const listMyBookings = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

  const filter = { user: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .populate('test', 'name price')
      .populate('centre', 'name location')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Booking.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { bookings },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// GET /api/bookings/:id
const getBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate('test', 'name price')
    .populate('centre', 'name location');

  if (!booking) throw new ApiError(404, 'Booking not found');

  const isOwner = booking.user.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== 'admin') {
    throw new ApiError(403, 'You are not authorized to view this booking');
  }

  res.status(200).json({ success: true, data: { booking } });
});

// PATCH /api/bookings/:id/cancel
const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(404, 'Booking not found');

  const isOwner = booking.user.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== 'admin') {
    throw new ApiError(403, 'You are not authorized to modify this booking');
  }

  if (booking.status !== Booking.STATUS.PENDING) {
    throw new ApiError(409, `Cannot cancel a booking in status "${booking.status}"`);
  }

  booking.status = Booking.STATUS.CANCELLED;
  await booking.save();

  res.status(200).json({ success: true, data: { booking } });
});

module.exports = { createBooking, listMyBookings, getBooking, cancelBooking };
