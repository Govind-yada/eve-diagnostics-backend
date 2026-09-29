const mongoose = require('mongoose');

const WEBHOOK_STATUS = Object.freeze({
  RECEIVED: 'RECEIVED',   // claimed, processing in progress
  PROCESSED: 'PROCESSED', // applied successfully (terminal)
  FAILED: 'FAILED',       // last attempt failed, a retry is expected
  DEAD: 'DEAD',           // retries exhausted (terminal, needs manual attention)
});

// Every inbound webhook call carries a provider-issued eventId. We persist it
// with a unique index BEFORE acting on the event. A duplicate-key violation on
// a later delivery tells us the event was already received, so we never apply
// it twice. `status`/`attempts`/`lastError` additionally make failures
// visible and let the retry worker and reconciliation job pick events back up.
const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    provider: { type: String, default: 'mock-payment-gateway' },
    payload: { type: mongoose.Schema.Types.Mixed },
    status: { type: String, enum: Object.values(WEBHOOK_STATUS), default: WEBHOOK_STATUS.RECEIVED, index: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

webhookEventSchema.statics.STATUS = WEBHOOK_STATUS;

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
