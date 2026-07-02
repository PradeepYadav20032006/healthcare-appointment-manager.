const { google } = require('googleapis');
const env = require('../config/env');
const prisma = require('../config/db');
const logger = require('../utils/logger');

function getOAuthClient() {
  return new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
}

function getAuthUrl(userId) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: userId, // used to associate the callback with the logged-in user
  });
}

async function handleOAuthCallback(code, userId) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  await prisma.googleToken.upsert({
    where: { userId },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || undefined,
      expiryDate: tokens.expiry_date ? BigInt(tokens.expiry_date) : undefined,
    },
    create: {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date ? BigInt(tokens.expiry_date) : undefined,
    },
  });
}

async function getAuthorizedClientForUser(userId) {
  const record = await prisma.googleToken.findUnique({ where: { userId } });
  if (!record) return null;

  const client = getOAuthClient();
  client.setCredentials({
    access_token: record.accessToken,
    refresh_token: record.refreshToken,
    expiry_date: record.expiryDate ? Number(record.expiryDate) : undefined,
  });

  // Persist refreshed access tokens so we don't have to re-auth every time.
  client.on('tokens', async (tokens) => {
    try {
      await prisma.googleToken.update({
        where: { userId },
        data: {
          accessToken: tokens.access_token || record.accessToken,
          refreshToken: tokens.refresh_token || record.refreshToken,
          expiryDate: tokens.expiry_date ? BigInt(tokens.expiry_date) : record.expiryDate,
        },
      });
    } catch (err) {
      logger.warn('Failed to persist refreshed Google token:', err.message);
    }
  });

  return client;
}

/**
 * Creates a calendar event for the given user. Returns the created event's
 * id, or null if the user hasn't connected Google Calendar or the API call
 * fails - calendar sync is best-effort and must never block booking.
 */
async function createEvent(userId, { summary, description, startISO, endISO, attendeeEmail }) {
  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) return null;

    const calendar = google.calendar({ version: 'v3', auth: client });
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary,
        description,
        start: { dateTime: startISO },
        end: { dateTime: endISO },
        attendees: attendeeEmail ? [{ email: attendeeEmail }] : undefined,
        reminders: { useDefault: true },
      },
    });
    return res.data.id;
  } catch (err) {
    logger.warn(`Google Calendar createEvent failed for user ${userId}:`, err.message);
    return null;
  }
}

async function updateEvent(userId, eventId, { summary, description, startISO, endISO }) {
  if (!eventId) return false;
  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) return false;

    const calendar = google.calendar({ version: 'v3', auth: client });
    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: {
        summary,
        description,
        start: startISO ? { dateTime: startISO } : undefined,
        end: endISO ? { dateTime: endISO } : undefined,
      },
    });
    return true;
  } catch (err) {
    logger.warn(`Google Calendar updateEvent failed for user ${userId}:`, err.message);
    return false;
  }
}

async function deleteEvent(userId, eventId) {
  if (!eventId) return false;
  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) return false;

    const calendar = google.calendar({ version: 'v3', auth: client });
    await calendar.events.delete({ calendarId: 'primary', eventId });
    return true;
  } catch (err) {
    logger.warn(`Google Calendar deleteEvent failed for user ${userId}:`, err.message);
    return false;
  }
}

module.exports = { getAuthUrl, handleOAuthCallback, createEvent, updateEvent, deleteEvent };
