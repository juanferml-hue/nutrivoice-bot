import OpenAI, { toFile } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 1. Transcripción de Notas de Voz
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const file = await toFile(audioBuffer, 'audio.ogg', { type: 'audio/ogg' });

  const response = await openai.audio.transcriptions.create({
    file: file,
    model: 'whisper-1',
    language: 'es'
  });

  return response.text;
}

// 2. Análisis Estructurado de Texto (Extracción de Datos a JSON)
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

// 3. Generación de Respuesta Conversacional
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

// 4. Análisis de Imágenes (Visión por Computadora)
export async function analyzeMealImage(imageBase64: string, mimeType: string = 'image/jpeg') {
  const systemPrompt = `Eres el motor de visión nutricional de NutriVoice. Analiza la imagen del plato de comida y devuelve ÚNICAMENTE un JSON válido con las calorías y macronutrientes estimados.
Si la imagen no contiene comida o alimentos claros, establece "is_food": false.

Esquema JSON esperado:
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
          { type: 'text', text: 'Analiza esta imagen de comida e identifica los ingredientes y sus macros desglosados:' },
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

// 5. Recomendación de Recetas según Saldo Restante (SPRINT VALOR)
export async function suggestRecipe(
  remainingMacros: { calories: number; protein: number; carbs: number; fats: number },
  userGoal: string
) {
  const systemPrompt = `
Eres un chef nutricionista de NutriVoice. Tu tarea es sugerir 2 opciones de recetas sencillas y rápidas de preparar que se adapten exactamente a los macronutrientes y calorías que le quedan disponibles al usuario hoy.
Usa ingredientes accesibles en Latinoamérica (Colombia).
Formato conciso con viñetas, ingredientes básicos y preparación en 2 pasos.
  `;

  const userPrompt = `
Objetivo del usuario: ${userGoal}
Macros restantes para hoy:
- Calorías: ${remainingMacros.calories} kcal
- Proteína: ${remainingMacros.protein} g
- Carbohidratos: ${remainingMacros.carbs} g
- Grasas: ${remainingMacros.fats} g
  `;

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

// 6. Generación de Lista de Compras Semanal (SPRINT VALOR)
export async function generateShoppingList(mealsHistory: any[], userGoal: string) {
  const systemPrompt = `
Eres un planificador de compras saludables para NutriVoice. 
Analiza los registros de alimentos de la última semana del usuario y genera una lista de compras recomendada agrupada por categorías (Proteínas, Verduras/Vegetales, Carbohidratos/Granos, Lácteos/Grasas saludables y Frutas).
Haz la lista práctica, orientada a mantener su objetivo (${userGoal}). Usar tono motivador y limpio.
  `;

  const userPrompt = `Historial de alimentos registrados en la semana: ${JSON.stringify(mealsHistory)}`;

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

// 7. Análisis de Avance Semanal (SPRINT VALOR)
export async function generateWeeklyProgress(
  userName: string,
  userGoal: string,
  targetCalories: number,
  mealsHistory: any[]
) {
  const systemPrompt = `
Eres un coach nutricional experto de NutriVoice. 
Crea un informe de avance semanal empático, motivador y directo basándote en los datos de la semana.
Estructura:
1. Resumen de consistencia (cuántos días registró alimentos).
2. Promedio diario de calorías consumidas vs su meta (${targetCalories} kcal).
3. Aspectos a destacar (puntos fuertes).
4. Un consejo clave de ajuste para la próxima semana alineado a su objetivo (${userGoal}).
  `;

  const userPrompt = `
Usuario: ${userName}
Meta: ${userGoal}
Meta calórica diaria: ${targetCalories} kcal
Historial de alimentos de la semana: ${JSON.stringify(mealsHistory)}
  `;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.6
  });

  return completion.choices[0].message.content;
}
