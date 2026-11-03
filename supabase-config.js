// Esta configuração contém apenas a chave publishable (pública) do Supabase.
// Segurança depende de RLS no banco; nunca coloque service_role neste arquivo.
window.MEU_PLANTAO_SUPABASE_CONFIG = Object.freeze({
  url: 'https://omwzurapeyhslwjdsuux.supabase.co',
  publishableKey: 'sb_publishable_fLEv9TPunrE7oJGD4VrJzg_XGpp31oq',
});

window.MEU_PLANTAO_SUPABASE_CLIENT = window.supabase?.createClient(
  window.MEU_PLANTAO_SUPABASE_CONFIG.url,
  window.MEU_PLANTAO_SUPABASE_CONFIG.publishableKey,
);
