const router = require('express').Router();
const {
  login,
  register,
  googleLogin,
  authConfig,
  me,
  changePassword,
  forgotPassword,
} = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

router.post('/login', login);
router.post('/register', register);
router.post('/forgot-password', forgotPassword);
router.post('/google', googleLogin);
router.get('/config', authConfig);
router.get('/me', authenticate, me);
router.put('/password', authenticate, changePassword);

module.exports = router;
