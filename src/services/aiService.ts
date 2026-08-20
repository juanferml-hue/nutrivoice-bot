import OpenAI from 'openai';
import FormData from 'form-data';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const formData = new FormData();
  formData.append('file', audioBuffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
  formData.append('model', 'whisper-1');
  formData.append('language', 'es');

  const response = await openai.audio.transcriptions.create({
    file: formData as any,
    model: 'whisper-1',
    language: 'es'
  });

  return response.text;
}

export async function analyzeMealText(transcription: string) {
  const systemPrompt = `Eres el motor nutricional de NutriVoice. Analiza el texto y devuelve ÚNICAMENTE un JSON válido con las calorías y macronutrientes estimados.
Si el texto no se refiere a alimentos o comida, establece "is_food": false.
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
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcription }
    ],
    temperature: 0.2
  });

  return JSON.parse(completion.choices[0].message.content || '{}');
}
