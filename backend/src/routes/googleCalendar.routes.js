/**
 * googleCalendar.routes.js - Google Calendar sync endpoints.
 *
 * Mounted at /api/calendar. Case-scoped endpoints live in cases.routes.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/googleCalendar.controller');

const router = express.Router();
router.use(authenticate);

router.get('/prefs',     ctrl.getPrefs);
router.post('/prefs',    ctrl.setPrefs);
router.get('/calendars', ctrl.listCalendars);

router.post('/vencimientos/:id/sync',   ctrl.syncVencimiento);
router.delete('/vencimientos/:id/sync', ctrl.unsyncVencimiento);
router.post('/actuaciones/:id/sync',    ctrl.syncActuacion);

module.exports = router;
