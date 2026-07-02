const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const reminderJob = require('./jobs/reminderJob');
const emailRetryJob = require('./jobs/emailRetryJob');

app.listen(env.port, () => {
  logger.info(`Healthcare Appointment Manager API listening on port ${env.port} (${env.nodeEnv})`);
  reminderJob.start();
  emailRetryJob.start();
});
