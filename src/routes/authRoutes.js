const express = require('express');
const { signup, login, me } = require('../controllers/authController');
const { signupValidator, loginValidator } = require('../validators/authValidators');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/signup', authLimiter, signupValidator, validate, signup);

router.post('/login', authLimiter, loginValidator, validate, login);

router.get('/me', protect, me);

module.exports = router;
