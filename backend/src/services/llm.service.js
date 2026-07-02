const env = require('../config/env');
const logger = require('../utils/logger');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Low-level call to the Anthropic Messages API.
 * Throws on network/API failure; callers are responsible for catching
 * and falling back so that a flaky LLM never blocks booking/visit flows.
 */
async function callClaude(systemPrompt, userPrompt) {
  if (!env.anthropic.apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.anthropic.model,
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    return textBlock ? textBlock.text : '';
  } finally {
    clearTimeout(timeout);
  }
}

function extractJson(rawText) {
  // The model is asked to return pure JSON, but we defensively strip
  // markdown code fences in case it adds them anyway.
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Pre-visit summary: urgency level, chief complaint, suggested questions.
 * Returns a fallback object (never throws) so a symptom-form submission
 * can never be blocked by an LLM outage.
 */
async function generatePreVisitSummary(symptoms) {
  const systemPrompt =
    'You are a clinical intake assistant. You do not diagnose. You summarise patient-reported ' +
    'symptoms for a doctor and flag urgency conservatively (when unsure, prefer the higher urgency). ' +
    'Respond with ONLY raw JSON, no markdown, no commentary, matching exactly this shape: ' +
    '{"urgency":"Low|Medium|High","chiefComplaint":"string","suggestedQuestions":["string","string","string"]}';

  const userPrompt = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptoms}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt);
    const parsed = extractJson(raw);
    return {
      urgency: normaliseUrgency(parsed.urgency),
      chiefComplaint: parsed.chiefComplaint || symptoms.slice(0, 200),
      suggestedQuestions: Array.isArray(parsed.suggestedQuestions)
        ? parsed.suggestedQuestions.slice(0, 3)
        : [],
      generatedBy: 'llm',
    };
  } catch (err) {
    logger.warn('Pre-visit LLM summary failed, using fallback:', err.message);
    return {
      urgency: 'Medium',
      chiefComplaint: symptoms.slice(0, 200),
      suggestedQuestions: [
        'Can you describe when the symptoms started?',
        'Have you taken any medication for this already?',
        'Have you experienced this before?',
      ],
      generatedBy: 'fallback',
      fallbackReason: err.message,
    };
  }
}

function normaliseUrgency(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'high') return 'High';
  if (v === 'low') return 'Low';
  return 'Medium';
}

/**
 * Post-visit summary: converts clinical notes into a patient-friendly
 * summary including medication schedule and follow-up steps.
 */
async function generatePostVisitSummary(notes, prescription) {
  const systemPrompt =
    'You are a patient-communication assistant. Rewrite clinical notes in warm, plain, ' +
    'non-technical language a patient can understand. Include the medication schedule and ' +
    'follow-up steps clearly. Do not invent information that is not in the notes. ' +
    'Respond with plain text only (no markdown headers), 150-250 words.';

  const prescriptionText = (prescription || [])
    .map((p) => `${p.name} ${p.dosage || ''} - ${p.frequencyPerDay || '?'}x/day for ${p.durationDays || '?'} days`)
    .join('; ');

  const userPrompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${notes}\n\nPrescription: ${prescriptionText || 'None'}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt);
    return { text: raw.trim(), generatedBy: 'llm' };
  } catch (err) {
    logger.warn('Post-visit LLM summary failed, using fallback:', err.message);
    return {
      text:
        `Here is a summary of your visit. Doctor's notes: ${notes}. ` +
        (prescriptionText
          ? `Prescribed medication: ${prescriptionText}. Please follow the schedule shared by your doctor.`
          : 'No medication was prescribed.') +
        ' Please contact the clinic if your symptoms worsen or do not improve.',
      generatedBy: 'fallback',
      fallbackReason: err.message,
    };
  }
}

module.exports = { generatePreVisitSummary, generatePostVisitSummary };
