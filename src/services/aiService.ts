import axios from 'axios';
import OpenAI from 'openai';
import FormData from 'form-data';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function downloadWhatsAppMedia(mediaId: string): Promise<Buffer> {
  const mediaUrlResponse = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` } }
  );

  const audioResponse = await axios.get(mediaUrlResponse.data.url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` },
    responseType: 'arraybuffer'
  });

  return Buffer.from(audioResponse.data);
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const formData = new FormData();
  formData.append('file', audioBuffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
  formData.append('model', 'whisper-1');
  formData.append('language', 'es');

  const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
    headers: { ...formData.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
  });

  return response.data.text;
}

export async function analyzeMealText(transcription: string) {
  const systemPrompt = `Eres el motor nutricional de NutriVoice. Analiza el texto y devuelve ÚNICAMENTE un JSON válido con las calorías y macronutrientes estimados.
Esquema JSON:
{
  "is_food": boolean,
  "meal_type": "desayuno" | "almuerzo" | "cena" | "snack",
  "items": [{"name": string, "portion_description": string, "calories": number, "protein_g": number, "carbs_g": number, "fats_g": number}],
  "total_calories": number,
  "total_protein_g": number,
  "total_carbs_g": number,
  "total_fats_g": number
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcription }
    ],
    temperature: 0.2
  });

  return JSON.parse(completion.choices[0].message.content || '{}');
}
