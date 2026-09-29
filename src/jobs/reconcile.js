const logger = require('../utils/logger');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const WebhookEvent = require('../models/WebhookEvent');
const { finalizePayment } = require('../services/paymentService');
const { processStoredEvent, markDead } = require('../services/webhookService');


async function reconcile(now = new Date()) {
  const paymentTimeoutMs = Number(process.env.PAYMENT_TIMEOUT_MINUTES || 15) * 60 * 1000;
  const staleMs = Number(process.env.WEBHOOK_STALE_SECONDS || 60) * 1000;
  const maxAttempts = Number(process.env.WEBHOOK_RETRY_ATTEMPTS || 5);
  const summary = { paymentsTimedOut: 0, bookingsExpired: 0, eventsReprocessed: 0, eventsDeadLettered: 0 };

  const stalePayments = await Payment.find({
    status: Payment.STATUS.PENDING,
    createdAt: { $lt: new Date(now.getTime() - paymentTimeoutMs) },
  }).limit(200);
  for (const payment of stalePayments) {
    const result = await finalizePayment(payment._id, Payment.STATUS.FAILED);
    if (!result.alreadyFinalized) summary.paymentsTimedOut += 1;
  }

  const expiredCandidates = await Booking.find({
    status: Booking.STATUS.PENDING,
    appointmentDate: { $lt: now },
  }).select('_id').limit(500);
  for (const booking of expiredCandidates) {
    if (await Payment.exists({ booking: booking._id, status: Payment.STATUS.PENDING })) continue;
    const res = await Booking.updateOne(
      { _id: booking._id, status: Booking.STATUS.PENDING },
      { $set: { status: Booking.STATUS.CANCELLED } }
    );
    summary.bookingsExpired += res.modifiedCount;
  }


  const staleEvents = await WebhookEvent.find({
    status: { $in: [WebhookEvent.STATUS.RECEIVED, WebhookEvent.STATUS.FAILED] },
    updatedAt: { $lt: new Date(now.getTime() - staleMs) },
  }).limit(200);
  for (const event of staleEvents) {
    if (event.attempts >= maxAttempts) {
      await markDead(event.eventId, new Error(event.lastError || 'retry budget exhausted'));
      summary.eventsDeadLettered += 1;
      continue;
    }
    try {
      await processStoredEvent(event.eventId);
      summary.eventsReprocessed += 1;
    } catch (err) {
      logger.warn({ eventId: event.eventId, err: err.message }, 'Reconciliation retry of webhook event failed');
    }
  }

  logger.info(summary, 'Reconciliation run complete');
  return summary;
}

module.exports = { reconcile };
