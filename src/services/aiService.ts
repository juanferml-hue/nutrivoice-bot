import OpenAI, { toFile } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Transcripción de Audio
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const file = await toFile(audioBuffer, 'audio.ogg', { type: 'audio/ogg' });

  const response = await openai.audio.transcriptions.create({
    file: file,
    model: 'whisper-1',
    language: 'es'
  });

  return response.text;
}

// Análisis de Texto
export async function analyzeMealText(transcription: string) {
  const systemPrompt = `Eres el motor nutricional de NutriVoice. Analiza el texto y devuelve ÚNICAMENTE un JSON válido con las calorías y macronutrientes estimados.
Si el texto no se refiere a alimentos, establece "is_food": false.
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

// Respuesta Conversacional con Consideraciones Nutricionales por Edad
export async function generateUserResponse(
  userMessage: string,
  mealData: any,
  remainingMacros: { calories: number; protein: number; carbs: number; fats: number },
  userAge?: number
) {
  const systemPrompt = `
Eres NutriVoice, un asistente de nutrición inteligente por WhatsApp.
Ten en cuenta la edad del usuario (${userAge || 'no especificada'}) para ajustar tus recomendaciones (por ejemplo, mayor requerimiento proteico o densidad de micronutrientes según la etapa de vida).

PERSONALIDAD Y TONO:
- Empático, directo y breve (3-4 oraciones).
- Muestra el desglose de nutrientes y el saldo restante.
  `;

  const contextPrompt = `
Mensaje del usuario: "${userMessage}"
Datos analizados: ${JSON.stringify(mealData)}
Saldo restante:
- Calorías: ${remainingMacros.calories} kcal
- Proteínas: ${remainingMacros.protein} g
- Carbohidratos: ${remainingMacros.carbs} g
- Grasas: ${remainingMacros.fats} g
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

// Análisis de Imágenes
export async function analyzeMealImage(imageBase64: string, mimeType: string = 'image/jpeg') {
  const systemPrompt = `Eres el motor de visión nutricional de NutriVoice. Analiza la imagen del plato de comida y devuelve ÚNICAMENTE un JSON válido.
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
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analiza la comida de la imagen:' },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`
            }
          }
        ]
      }
    ],
    temperature: 0.2
  });

  return JSON.parse(completion.choices[0].message.content || '{}');
}

// Sugerencia de Recetas
export async function suggestRecipe(
  remainingMacros: { calories: number; protein: number; carbs: number; fats: number },
  userGoal: string
) {
  const systemPrompt = `
Eres un chef nutricionista. Sugiere 2 recetas fáciles orientadas a: ${userGoal}.
Usa ingredientes accesibles en Latinoamérica. Formato limpio en viñetas.
  `;

  const userPrompt = `Macros restantes: ${JSON.stringify(remainingMacros)}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7
  });

  return completion.choices[0].message.content;
}

// Generación de Lista de Compras
export async function generateShoppingList(mealsHistory: any[], userGoal: string) {
  const systemPrompt = `
Eres un planificador de compras saludables para NutriVoice. 
Genera una lista de mercado organizada por categorías (Proteínas, Vegetales, Carbohidratos, Grasas Saludables, Frutas) optimizada para el objetivo de: ${userGoal}.
Tono motivador y estructurado en viñetas.
  `;

  const userPrompt = `Genera la lista recomendada para la semana.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.5
  });

  return completion.choices[0].message.content;
}

// Informe Semanal
export async function generateWeeklyProgress(
  userName: string,
  userGoal: string,
  targetCalories: number,
  mealsHistory: any[]
) {
  const systemPrompt = `
Crea un informe de avance semanal empático y conciso para ${userName} enfocado en su meta (${userGoal}).
  `;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Meta diaria: ${targetCalories} kcal.` }
    ],
    temperature: 0.6
  });

  return completion.choices[0].message.content;
}
