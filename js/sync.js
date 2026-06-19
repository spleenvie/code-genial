const GenzySync = (() => {
  const ROW_ID = 'main';
  const DEBOUNCE_MS = 400;
  const LOCAL_KEY = 'genzy_v4';

  let supabase = null;
  let channel = null;
  let saveTimer = null;
  let saving = false;
  let pendingSave = false;
  let suppressRemote = false;
  let lastPushedAt = 0;
  let onRemoteUpdate = null;
  let onStatusChange = null;

  function setStatus(status, detail) {
    if (onStatusChange) onStatusChange(status, detail);
  }

  function isConfigured() {
    const cfg = window.GENZY_CONFIG;
    return !!(cfg?.supabaseUrl && cfg?.supabaseAnonKey &&
      !cfg.supabaseUrl.includes('VOTRE_PROJET'));
  }

  function initClient() {
    if (!window.supabase?.createClient) {
      throw new Error('Client Supabase non chargé');
    }
    const { supabaseUrl, supabaseAnonKey } = window.GENZY_CONFIG;
    supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  }

  function isEmptyState(data) {
    return !data || !data.agencyTasks || !data.clients;
  }

  async function loadFromRemote() {
    const { data, error } = await supabase
      .from('dashboard_state')
      .select('data, updated_at')
      .eq('id', ROW_ID)
      .maybeSingle();

    if (error) throw error;
    if (!data || isEmptyState(data.data)) return null;
    return data.data;
  }

  function loadFromLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isEmptyState(parsed) ? null : parsed;
    } catch {
      return null;
    }
  }

  function saveToLocal(state) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    } catch { /* quota */ }
  }

  async function pushState(state) {
    const payload = {
      id: ROW_ID,
      data: state,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('dashboard_state')
      .upsert(payload, { onConflict: 'id' });

    if (error) throw error;
    lastPushedAt = Date.now();
    saveToLocal(state);
  }

  async function flushSave(getState) {
    if (!supabase) return;
    const state = getState();
    if (!state) return;

    if (saving) {
      pendingSave = true;
      return;
    }

    saving = true;
    setStatus('saving', 'Enregistrement…');

    try {
      suppressRemote = true;
      await pushState(state);
      setStatus('synced', 'Synchronisé');
    } catch (err) {
      console.error('Genzy sync error:', err);
      saveToLocal(state);
      setStatus('error', 'Erreur de sync — sauvegarde locale');
    } finally {
      saving = false;
      suppressRemote = false;
      if (pendingSave) {
        pendingSave = false;
        scheduleSave(getState);
      }
    }
  }

  function scheduleSave(getState) {
    if (!supabase) {
      saveToLocal(getState());
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave(getState), DEBOUNCE_MS);
  }

  function subscribeRealtime(getState, applyRemote) {
    channel = supabase
      .channel('genzy-dashboard')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'dashboard_state',
        filter: `id=eq.${ROW_ID}`
      }, (payload) => {
        if (suppressRemote) return;
        if (Date.now() - lastPushedAt < 800) return;

        const remote = payload.new?.data;
        if (!remote || isEmptyState(remote)) return;

        const local = getState();
        if (JSON.stringify(local) === JSON.stringify(remote)) return;

        applyRemote(remote);
        saveToLocal(remote);
        if (onRemoteUpdate) onRemoteUpdate(remote);
        setStatus('synced', 'Mis à jour par un collaborateur');
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setStatus('synced', 'Temps réel actif');
        if (status === 'CHANNEL_ERROR') setStatus('error', 'Connexion temps réel interrompue');
      });
  }

  async function init(getDefaultState, applyState) {
    if (!isConfigured()) {
      const local = loadFromLocal();
      applyState(local || getDefaultState());
      setStatus('offline', 'Mode local — configurer Supabase');
      return { mode: 'local' };
    }

    setStatus('loading', 'Connexion à la base…');

    try {
      initClient();
      let state = await loadFromRemote();

      if (!state) {
        const local = loadFromLocal();
        state = local || getDefaultState();
        try {
          await pushState(state);
        } catch (pushErr) {
          console.warn('Initial push failed, continuing with local state:', pushErr);
        }
      }

      applyState(state);
      saveToLocal(state);
      subscribeRealtime(
        () => window.S,
        (remote) => { window.S = remote; }
      );
      setStatus('synced', 'Connecté');
      return { mode: 'remote' };
    } catch (err) {
      console.error('Genzy init error:', err);
      const fallback = loadFromLocal() || getDefaultState();
      applyState(fallback);
      setStatus('error', 'Connexion échouée — mode local');
      return { mode: 'fallback' };
    }
  }

  function save(getState) {
    if (!isConfigured()) {
      saveToLocal(getState());
      setStatus('offline', 'Mode local');
      return;
    }
    scheduleSave(getState);
  }

  function destroy() {
    clearTimeout(saveTimer);
    if (channel) supabase?.removeChannel(channel);
  }

  return {
    init,
    save,
    destroy,
    isConfigured,
    onRemoteUpdate: (fn) => { onRemoteUpdate = fn; },
    onStatusChange: (fn) => { onStatusChange = fn; }
  };
})();
