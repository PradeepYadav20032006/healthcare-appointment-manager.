const cron = require('node-cron');
const emailService = require('../services/email.service');
const logger = require('../utils/logger');

function start() {
  // Every 5 minutes: retry any FAILED notifications (SMTP hiccup, network
  // blip, etc.) up to MAX_ATTEMPTS. See email.service.js for details.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const count = await emailService.retryFailedNotifications();
      if (count) logger.info(`Retried ${count} failed notification(s).`);
    } catch (err) {
      logger.error('emailRetryJob tick failed:', err.message);
    }
  });

  logger.info('Email retry cron job started.');
}

module.exports = { start };
