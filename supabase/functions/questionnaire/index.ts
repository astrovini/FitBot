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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { action, userId, answers, runId, status } = await req.json()

    if (action === 'getStatus') {
      // Check user's questionnaire status
      const { data: form, error: formError } = await supabaseClient
        .schema('questionnaire')
        .from('forms')
        .select('id')
        .eq('slug', 'onboarding_v1')
        .single()

      if (formError) throw formError

      const { data: runs, error: runError } = await supabaseClient
        .schema('questionnaire')
        .from('runs')
        .select('id, status, started_at, submitted_at')
        .eq('user_id', userId)
        .eq('form_id', form.id)
        .order('started_at', { ascending: false })
        .limit(1)

      if (runError) throw runError

      if (!runs || runs.length === 0) {
        return new Response(JSON.stringify({ status: 'not_started' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const run = runs[0]
      return new Response(JSON.stringify({ 
        status: run.status === 'submitted' ? 'completed' : 'in_progress',
        run: run
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'getExistingRun') {
      // Get existing run with answers
      const { data: form, error: formError } = await supabaseClient
        .schema('questionnaire')
        .from('forms')
        .select('id')
        .eq('slug', 'onboarding_v1')
        .single()

      if (formError) throw formError

      const { data: run, error: runError } = await supabaseClient
        .schema('questionnaire')
        .from('runs')
        .select('id, status, started_at, submitted_at')
        .eq('user_id', userId)
        .eq('form_id', form.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .single()

      if (runError) throw runError

      // Get existing answers
      const { data: answers, error: answersError } = await supabaseClient
        .schema('questionnaire')
        .from('answers')
        .select('question_id, text_value, selected_values')
        .eq('run_id', run.id)

      if (answersError) throw answersError

      return new Response(JSON.stringify({ run: run, answers: answers }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'getForm') {
      // Get complete form structure
      const { data: form, error: formError } = await supabaseClient
        .schema('questionnaire')
        .from('forms')
        .select('id, title')
        .eq('slug', 'onboarding_v1')
        .single()

      if (formError) throw formError

      const { data: sections, error: sectionsError } = await supabaseClient
        .schema('questionnaire')
        .from('sections')
        .select('id, title, sort_order')
        .eq('form_id', form.id)
        .order('sort_order')

      if (sectionsError) throw sectionsError

      const { data: questions, error: questionsError } = await supabaseClient
        .schema('questionnaire')
        .from('questions')
        .select('id, section_id, key, prompt, type, required, options, sort_order')
        .in('section_id', sections.map(s => s.id))
        .order('sort_order')

      if (questionsError) throw questionsError

      // Group questions by section
      const formWithSections = {
        ...form,
        sections: sections.map(section => ({
          ...section,
          questions: questions.filter(q => q.section_id === section.id)
        }))
      }

      return new Response(JSON.stringify({ form: formWithSections }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'startRun') {
      console.log('startRun called with userId:', userId);
      
      // Get form ID using questionnaire schema
      const { data: form, error: formError } = await supabaseClient
        .schema('questionnaire')
        .from('forms')
        .select('id')
        .eq('slug', 'onboarding_v1')
        .single()

      console.log('Form query result:', { form, formError });

      if (formError || !form) {
        throw new Error(`Form not found: ${formError?.message || 'No form returned'}`);
      }

      // Check existing run
      const { data: existingRuns, error: runError } = await supabaseClient
        .schema('questionnaire')
        .from('runs')
        .select('id, status')
        .eq('user_id', userId)
        .eq('form_id', form.id)
        .order('started_at', { ascending: false })
        .limit(1)

      console.log('Existing runs query:', { existingRuns, runError });

      if (existingRuns && existingRuns.length > 0) {
        return new Response(JSON.stringify({ run: existingRuns[0] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Create new run
      const { data: newRun, error: createError } = await supabaseClient
        .schema('questionnaire')
        .from('runs')
        .insert([{ user_id: userId, form_id: form.id }])
        .select()
        .single()

      console.log('Create run result:', { newRun, createError });

      if (createError) throw createError

      return new Response(JSON.stringify({ run: newRun }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'saveAnswers') {
      console.log('saveAnswers called with runId:', runId, 'answers:', answers, 'status:', status);
      
      // Delete existing answers for this run
      await supabaseClient
        .schema('questionnaire')
        .from('answers')
        .delete()
        .eq('run_id', runId)

      // Insert new answers
      if (answers && answers.length > 0) {
        const { error } = await supabaseClient
          .schema('questionnaire')
          .from('answers')
          .insert(answers)

        if (error) throw error
      }

      // Update run status
      const updateData = { status: status || 'in_progress' }
      if (status === 'submitted') {
        updateData.submitted_at = new Date().toISOString()
      }

      await supabaseClient
        .schema('questionnaire')
        .from('runs')
        .update(updateData)
        .eq('id', runId)

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    throw new Error('Invalid action')

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
