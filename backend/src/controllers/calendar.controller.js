const ApiError = require('../utils/apiError');
const calendarService = require('../services/calendar.service');
const env = require('../config/env');

async function getAuthUrl(req, res) {
  const url = calendarService.getAuthUrl(req.user.id);
  res.json({ url });
}

// Public redirect target (no Authorization header available) - the
// `state` param carries the userId set when the auth URL was generated.
async function callback(req, res) {
  const { code, state } = req.query;
  if (!code || !state) throw new ApiError(400, 'Missing code or state');
  await calendarService.handleOAuthCallback(code, state);
  res.redirect(`${env.frontendUrl}/calendar-connected`);
}

module.exports = { getAuthUrl, callback };
