import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const { userId } = await req.json()

    // Fetch user data
    const { data: user, error } = await supabaseClient
      .from('Users')
      .select('name, surname, height, weight, age')
      .eq('id', userId)
      .single()

    if (error) throw error

    // Calculate BMI
    const heightInMeters = user.height / 100
    const bmi = user.weight / (heightInMeters * heightInMeters)
    
    let category = ''
    if (bmi < 18.5) category = 'Underweight'
    else if (bmi < 25) category = 'Normal weight'
    else if (bmi < 30) category = 'Overweight'
    else category = 'Obese'

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Create a fitness plan for BMI ${Math.round(bmi * 10) / 10}`
        }],
        max_tokens: 100
      })
    })

    const aiData = await openaiResponse.json()

    // Debug: return the full response to see what's wrong
    if (!aiData.choices || !aiData.choices[0]) {
      return new Response(
        JSON.stringify({
          error: "OpenAI API error",
          debug: aiData
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        },
      )
    }

    return new Response(
      JSON.stringify({
        user: `${user.name} ${user.surname}`,
        bmi: Math.round(bmi * 10) / 10,
        category,
        aiRecommendations: aiData.choices[0].message.content
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
