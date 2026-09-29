const logger = require('../utils/logger');
const cache = require('../utils/cache');
const WebhookEvent = require('../models/WebhookEvent');
const { applyPaymentEvent } = require('./paymentService');
const jobs = require('../jobs/queues');

const { STATUS } = WebhookEvent;
const STALE_MS = () => Number(process.env.WEBHOOK_STALE_SECONDS || 60) * 1000;
const DONE_TTL_SECONDS = 24 * 60 * 60;
const doneKey = (eventId) => `webhook:done:${eventId}`;

// Applies a stored event and records the outcome on the event document.
// Used inline by the HTTP handler AND by the retry worker / reconciliation job.
async function processStoredEvent(eventId) {
  const event = await WebhookEvent.findOne({ eventId });
  if (!event || event.status === STATUS.PROCESSED || event.status === STATUS.DEAD) {
    return { skipped: true };
  }
  try {
    const result = await applyPaymentEvent(event.payload);
    await WebhookEvent.updateOne(
      { eventId },
      { $set: { status: STATUS.PROCESSED, processedAt: new Date(), lastError: null } }
    );
    await cache.set(doneKey(eventId), 1, DONE_TTL_SECONDS);
    return { result };
  } catch (err) {
    await WebhookEvent.updateOne(
      { eventId },
      { $set: { status: STATUS.FAILED, lastError: err.message }, $inc: { attempts: 1 } }
    );
    throw err;
  }
}

// Terminal failure: retries exhausted. Kept in the DB for manual follow-up.
async function markDead(eventId, err) {
  await WebhookEvent.updateOne(
    { eventId },
    { $set: { status: STATUS.DEAD, lastError: err && err.message ? err.message : String(err) } }
  );
  logger.error({ eventId, err: err && err.message }, 'Webhook event dead-lettered after exhausting retries');
}

// One processing attempt for an event we own. On failure: schedule a
// server-side retry if a queue exists; otherwise release the claim so the
// provider's own retry is processed instead of being swallowed as a duplicate.
async function attempt(eventId) {
  try {
    const { result } = await processStoredEvent(eventId);
    return { outcome: 'processed', result };
  } catch (err) {
    if (await jobs.enqueueWebhookRetry(eventId)) {
      return { outcome: 'queued', error: err.message };
    }
    await WebhookEvent.deleteOne({ eventId }).catch((e) =>
      logger.error({ err: e, eventId }, 'Failed to release webhook event claim')
    );
    throw err;
  }
}

// The event id already exists: decide what a repeat delivery means.
async function handleDuplicate(payload) {
  const { eventId } = payload;
  const existing = await WebhookEvent.findOne({ eventId });
  if (!existing) return receiveWebhook(payload); // claim was released between our insert and read — start over

  if (existing.status === STATUS.PROCESSED) return { outcome: 'duplicate' };
  if (existing.status === STATUS.DEAD) return { outcome: 'dead' };

  // RECEIVED / FAILED: someone else is working on it, or it got orphaned
  // (crash, lost job). If it's stale, take it over — safe because applying an
  // event is idempotent, so a concurrent retry job just sees PROCESSED and skips.
  const ageMs = Date.now() - new Date(existing.updatedAt).getTime();
  if (ageMs > STALE_MS()) return attempt(eventId);
  return { outcome: 'in_progress' };
}

async function receiveWebhook(payload) {
  const { eventId } = payload;

  // Fast path: Redis remembers events that already completed successfully.
  // MongoDB remains the source of truth — Redis only ever short-circuits
  // events known to be finished, so a lost/cold cache is harmless.
  if (await cache.exists(doneKey(eventId))) return { outcome: 'duplicate' };

  // Layer 1 of idempotency — claim the eventId via a unique index.
  try {
    await WebhookEvent.create({ eventId, payload, status: STATUS.RECEIVED });
  } catch (err) {
    if (err.code === 11000) return handleDuplicate(payload);
    throw err;
  }

  // Layer 2 (conditional PENDING-only transitions) lives in finalizePayment().
  return attempt(eventId);
}

module.exports = { receiveWebhook, processStoredEvent, markDead };
