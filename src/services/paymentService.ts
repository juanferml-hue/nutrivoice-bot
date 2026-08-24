import { MercadoPagoConfig, Preference } from 'mercadopago';

// Configurar cliente de Mercado Pago con tu Access Token de Colombia
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || ''
});

export async function createPaymentLink(userPhone: string): Promise<string> {
  const preference = new Preference(client);

  const response = await preference.create({
    body: {
      items: [
        {
          id: 'nutrivoice-pro-monthly',
          title: 'NutriVoice PRO - Plan Mensual',
          quantity: 1,
          unit_price: 20000, // Precio en COP (Ejemplo: $20.000 COP/mes)
          currency_id: 'COP'
        }
      ],
      payer: {
        phone: {
          number: userPhone
        }
      },
      external_reference: userPhone, // Usamos el número de teléfono para identificar quién pagó en el Webhook
      back_urls: {
        success: 'https://whatsapp.com',
        failure: 'https://whatsapp.com',
        pending: 'https://whatsapp.com'
      },
      auto_return: 'approved'
    }
  });

  return response.init_point || '';
}
