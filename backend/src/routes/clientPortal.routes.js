/**
 * clientPortal.routes.js — endpoints PÚBLICOS del portal del cliente.
 *
 * Sin authenticate middleware: el token en la URL es la auth.
 * Rate-limit en server.js (no añadido todavía — añadir si abusan).
 */

const express = require('express');
const ctrl = require('../controllers/clientPortal.controller');

const router = express.Router();

router.get('/:token', ctrl.publicDashboard);

module.exports = router;
