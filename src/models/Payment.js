const mongoose = require('mongoose');

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
});

const paymentSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.PENDING },
    // Simulated gateway's transaction id — this is what the webhook refers back to.
    providerTransactionId: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

paymentSchema.statics.STATUS = PAYMENT_STATUS;

module.exports = mongoose.model('Payment', paymentSchema);
