const express = require('express');
const { initiatePayment, paymentWebhook } = require('../controllers/paymentController');
const { initiatePaymentValidator, webhookValidator } = require('../validators/paymentValidators');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/', protect, initiatePaymentValidator, validate, initiatePayment);

router.post('/webhook', apiLimiter, webhookValidator, validate, paymentWebhook);

module.exports = router;
