const router = require('express').Router();
const {
  getClients, getClientById, createClient, updateClient, deleteClient,
  getClientCases
} = require('../controllers/clients.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', getClients);
router.get('/:id', getClientById);
router.post('/', createClient);
router.put('/:id', updateClient);
router.delete('/:id', deleteClient);
router.get('/:id/cases', getClientCases);

module.exports = router;
