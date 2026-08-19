import express from 'express';
import dotenv from 'dotenv';
import { downloadWhatsAppMedia, transcribeAudio, analyzeMealText } from './services/aiService';

dotenv.config();
const app = express();
app.use(express.json());

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];

    if (message && message.type === 'audio') {
      const audioBuffer = await downloadWhatsAppMedia(message.audio.id);
      const text = await transcribeAudio(audioBuffer);
      const nutritionData = await analyzeMealText(text);

      console.log('Análisis Nutricional completado:', nutritionData);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error procesando webhook:', error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NutriVoice activo en puerto ${PORT}`));
