const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const { finalizePayment } = require('../services/paymentService');
const { receiveWebhook } = require('../services/webhookService');

const SUCCESS_RATE = () => Number(process.env.PAYMENT_SUCCESS_RATE ?? 0.8);

// POST /api/payments/
// Simulates initiating payment for a booking. By default it resolves
// synchronously (as the assignment describes). Pass `{ async: true }` to
// instead leave the payment PENDING, mimicking a real gateway that reports
// the final outcome later via POST /payments/webhook/.
const initiatePayment = asyncHandler(async (req, res) => {
  const { bookingId, async: simulateAsync } = req.body;

  const booking = await Booking.findById(bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found');

  const isOwner = booking.user.toString() === req.user._id.toString();
  if (!isOwner) throw new ApiError(403, 'You are not authorized to pay for this booking');

  if (![Booking.STATUS.PENDING, Booking.STATUS.FAILED].includes(booking.status)) {
    throw new ApiError(409, `Cannot initiate payment for a booking in status "${booking.status}"`);
  }

  const inFlight = await Payment.exists({ booking: booking._id, status: Payment.STATUS.PENDING });
  if (inFlight) {
    throw new ApiError(409, 'A payment for this booking is already in progress');
  }

  const payment = await Payment.create({
    booking: booking._id,
    amount: booking.amount,
    status: Payment.STATUS.PENDING,
    providerTransactionId: `sim_${uuidv4()}`,
  });

  if (simulateAsync) {
    // Leave it PENDING — a later call to /payments/webhook/ with this
    // payment's providerTransactionId will finalize it (or the reconciliation
    // job times it out if no webhook ever arrives).
    return res.status(202).json({
      success: true,
      message: 'Payment initiated and pending confirmation via webhook',
      data: { payment, booking },
    });
  }

  // Synchronous simulation: resolve the outcome immediately, right now.
  const outcome = Math.random() < SUCCESS_RATE() ? Payment.STATUS.SUCCESS : Payment.STATUS.FAILED;
  const result = await finalizePayment(payment._id, outcome);

  if (!result.booking && !result.alreadyFinalized) {
    throw new ApiError(409, 'This booking was already resolved by a concurrent payment attempt');
  }

  res.status(outcome === Payment.STATUS.SUCCESS ? 200 : 402).json({
    success: outcome === Payment.STATUS.SUCCESS,
    data: { payment: result.payment, booking: result.booking ?? booking },
  });
});

// POST /api/payments/webhook/
// Called by the (simulated) payment provider to report a final payment
// status out-of-band. Idempotent — see services/webhookService.js.
const paymentWebhook = asyncHandler(async (req, res) => {
  const { eventId, providerTransactionId, status } = req.body;
  const outcome = await receiveWebhook({ eventId, providerTransactionId, status });

  switch (outcome.outcome) {
    case 'processed':
      return res.status(200).json({
        success: true,
        ...(outcome.result.alreadyFinalized ? { message: 'Payment already finalized (idempotent no-op)' } : {}),
        data: { payment: outcome.result.payment, booking: outcome.result.booking },
      });
    case 'duplicate':
      return res.status(200).json({ success: true, message: 'Event already processed (idempotent no-op)' });
    case 'dead':
      return res.status(200).json({
        success: true,
        message: 'Event previously failed permanently (dead-lettered); manual follow-up required',
      });
    case 'queued':
      return res.status(202).json({
        success: true,
        message: 'Event accepted; processing failed and a retry has been scheduled',
      });
    default: // 'in_progress'
      return res.status(202).json({
        success: true,
        message: 'Event already received; processing or retry is in progress',
      });
  }
});

module.exports = { initiatePayment, paymentWebhook };
