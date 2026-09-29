const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');

/**
 * Applies a final payment outcome to a Payment + its Booking, idempotently.
 * Used by the synchronous payment endpoint, the webhook, the retry worker and
 * the reconciliation job — the ONE place that can move payment/booking state.
 *
 * Step 1: PENDING -> final on the Payment is a conditional atomic update, so
 *         only one caller can ever win the transition.
 * Step 2: the Booking is reconciled from the payment's *stored* status (never
 *         from the incoming event) on EVERY call, guarded by a conditional
 *         update on non-terminal booking states. Safe to re-run: if a previous
 *         run crashed between step 1 and step 2, a retry completes the booking,
 *         and a conflicting late event can never flip a finalized outcome.
 */
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

// Looks up the payment a provider event refers to and applies its outcome.
async function applyPaymentEvent({ providerTransactionId, status }) {
  const payment = await Payment.findOne({ providerTransactionId });
  if (!payment) {
    throw new ApiError(404, 'No payment found for the given providerTransactionId');
  }
  return finalizePayment(payment._id, status);
}

module.exports = { finalizePayment, applyPaymentEvent };
