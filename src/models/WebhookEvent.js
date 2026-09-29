const mongoose = require('mongoose');

const WEBHOOK_STATUS = Object.freeze({
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
});

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
