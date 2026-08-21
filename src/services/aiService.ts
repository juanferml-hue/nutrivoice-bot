import OpenAI from 'openai';
import FormData from 'form-data';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 1. Transcripción de Notas de Voz
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

// 2. Análisis Estructurado (Extracción de Datos a JSON)
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

// 3. Generación de Respuesta Conversacional (Fase 2: Tono Empático, Conciso y Motivador)
export async function generateUserResponse(
  userMessage: string,
  mealData: any,
  remainingMacros: { calories: number; protein: number; carbs: number; fats: number }
) {
  const systemPrompt = `
Eres NutriVoice, un asistente de nutrición inteligente por WhatsApp.
Tu objetivo es ayudar al usuario a registrar sus alimentos y mantener la disciplina en su meta.

PERSONALIDAD Y TONO:
- Empático: Valida sus esfuerzos, entiende sus barreras sin juzgar.
- Conciso: Mensajes breves (máximo 3-4 oraciones). Usa viñetas para datos numéricos.
- Motivador: Cierra siempre con una frase ligera de impulso o una pregunta corta para continuar.

REGLAS DE RESPUESTA AL REGISTRAR ALIMENTOS:
1. Analiza los alimentos y desglosa brevemente los macros consumidos en esta comida.
2. Muestra siempre el saldo restante del día basándote en la información proporcionada.
3. Si el usuario se pasa de su meta o consume algo poco nutritivo, no lo regañes; ajústalo con empatía.
  `;

  const contextPrompt = `
Mensaje del usuario: "${userMessage}"
Datos analizados de la comida: ${JSON.stringify(mealData)}
Saldo restante del día tras este registro:
- Calorías restantes: ${remainingMacros.calories} kcal
- Proteínas restantes: ${remainingMacros.protein} g
- Carbohidratos restantes: ${remainingMacros.carbs} g
- Grasas restantes: ${remainingMacros.fats} g
  `;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextPrompt }
    ],
    temperature: 0.7
  });

  return completion.choices[0].message.content;
}
