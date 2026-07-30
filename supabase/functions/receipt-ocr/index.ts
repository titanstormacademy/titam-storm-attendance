import { createClient } from 'npm:@supabase/supabase-js@2.100.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Authentication required' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    const geminiModel = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash'
    if (!geminiApiKey) return json({ error: 'Receipt OCR is not configured' }, 503)

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
    })
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid session' }, 401)

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return json({ error: 'Admin access required' }, 403)

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return json({ error: 'Receipt image is required' }, 400)
    if (!file.type.startsWith('image/')) return json({ error: 'Receipt must be an image' }, 400)
    if (file.size > 10 * 1024 * 1024) return json({ error: 'Receipt must be smaller than 10 MB' }, 400)

    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }

    const prompt = 'Read this Malaysian basketball academy payment receipt. Extract the total paid in Malaysian Ringgit, transaction date, payment method, and transaction reference. Method must be one of Cash, Bank Transfer, Touch \'n Go eWallet, Online, or Others. Return null for unreadable fields.'
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: file.type, data: btoa(binary) } }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              amount: { type: 'NUMBER', nullable: true },
              date: { type: 'STRING', nullable: true },
              method: { type: 'STRING', nullable: true },
              reference: { type: 'STRING', nullable: true },
              confidence: { type: 'NUMBER', nullable: true },
            },
            required: ['amount', 'date', 'method', 'reference', 'confidence'],
          },
        },
      }),
    })

    if (!response.ok) return json({ error: `Gemini request failed (${response.status})` }, 502)
    const body = await response.json()
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return json({ error: 'No receipt details were returned' }, 502)

    const result = JSON.parse(text)
    const methods = ['Cash', 'Bank Transfer', "Touch 'n Go eWallet", 'Online', 'Others']
    return json({
      ok: true,
      amount: typeof result.amount === 'number' ? result.amount : null,
      date: typeof result.date === 'string' ? result.date : null,
      method: methods.includes(result.method) ? result.method : null,
      reference: typeof result.reference === 'string' ? result.reference : null,
      confidence: typeof result.confidence === 'number' ? result.confidence : null,
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Receipt OCR failed' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
