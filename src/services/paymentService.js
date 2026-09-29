const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');

async function finalizePayment(paymentId, status) {
  const transitioned = await Payment.findOneAndUpdate(
    { _id: paymentId, status: Payment.STATUS.PENDING },
    { $set: { status } },
    { new: true }
  );
  const payment = transitioned || (await Payment.findById(paymentId));

  const newBookingStatus = payment.status === Payment.STATUS.SUCCESS ? Booking.STATUS.CONFIRMED : Booking.STATUS.FAILED;
  const booking = await Booking.findOneAndUpdate(
    { _id: payment.booking, status: { $in: [Booking.STATUS.PENDING, Booking.STATUS.FAILED] } },
    { $set: { status: newBookingStatus } },
    { new: true }
  );
  if (!booking) {
    logger.info({ bookingId: payment.booking }, 'Booking already in a terminal state; left unchanged');
  }

  return { payment, booking, alreadyFinalized: !transitioned };
}

async function applyPaymentEvent({ providerTransactionId, status }) {
  const payment = await Payment.findOne({ providerTransactionId });
  if (!payment) {
    throw new ApiError(404, 'No payment found for the given providerTransactionId');
  }
  return finalizePayment(payment._id, status);
}

module.exports = { finalizePayment, applyPaymentEvent };
