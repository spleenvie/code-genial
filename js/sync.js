const GenzySync = (() => {
  const ROW_ID = 'main';
  const DEBOUNCE_MS = 300;
  const POLL_MS = 2000;
  const LOCAL_KEY = 'genzy_v4';
  const CHANNEL_NAME = 'genzy-live';

  let supabase = null;
  let channel = null;
  let pollTimer = null;
  let saveTimer = null;
  let saving = false;
  let pendingSave = false;
  let suppressRemote = false;
  let lastPushedAt = 0;
  let lastRemoteAt = null;
  let clientId = Math.random().toString(36).slice(2);
  let onRemoteUpdate = null;
  let onStatusChange = null;
  let getStateRef = null;
  let applyStateRef = null;

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
    supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }

  function isEmptyState(data) {
    return !data || !data.agencyTasks || !data.clients;
  }

  async function fetchRemote() {
    const { data, error } = await supabase
      .from('dashboard_state')
      .select('data, updated_at')
      .eq('id', ROW_ID)
      .maybeSingle();
    if (error) throw error;
    return data;
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

  async function pullRemote(force = false) {
    if (!supabase || !getStateRef || !applyStateRef) return;
    if (!force && (suppressRemote || Date.now() - lastPushedAt < 1200)) return;

    try {
      const row = await fetchRemote();
      if (!row || isEmptyState(row.data)) return;
      if (!force && row.updated_at === lastRemoteAt) return;

      const local = getStateRef();
      if (JSON.stringify(local) === JSON.stringify(row.data)) {
        lastRemoteAt = row.updated_at;
        return;
      }

      lastRemoteAt = row.updated_at;
      applyStateRef(row.data);
      saveToLocal(row.data);
      if (onRemoteUpdate) onRemoteUpdate(row.data);
      setStatus('synced', 'Mis à jour');
    } catch (err) {
      console.warn('Genzy pull error:', err);
    }
  }

  async function pushState(state) {
    const payload = {
      id: ROW_ID,
      data: state,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('dashboard_state')
      .upsert(payload, { onConflict: 'id' })
      .select('updated_at')
      .single();

    if (error) throw error;

    lastPushedAt = Date.now();
    lastRemoteAt = data?.updated_at || payload.updated_at;
    saveToLocal(state);

    if (channel) {
      channel.send({
        type: 'broadcast',
        event: 'state-changed',
        payload: { from: clientId, at: lastRemoteAt }
      });
    }
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
      console.error('Genzy push error:', err);
      saveToLocal(state);
      setStatus('error', 'Erreur de sync');
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
    getStateRef = getState;
    if (!supabase) {
      saveToLocal(getState());
      setStatus('offline', 'Hors ligne');
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave(getState), DEBOUNCE_MS);
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => pullRemote(), POLL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') pullRemote(true);
  }

  function subscribeChannel() {
    channel = supabase
      .channel(CHANNEL_NAME, { config: { broadcast: { ack: false, self: false } } })
      .on('broadcast', { event: 'state-changed' }, (msg) => {
        if (msg.payload?.from === clientId) return;
        pullRemote(true);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'dashboard_state',
        filter: `id=eq.${ROW_ID}`
      }, () => pullRemote(true))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setStatus('synced', 'Temps réel actif');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setStatus('synced', 'Sync auto (2s)');
        }
      });
  }

  async function init(getDefaultState, applyState) {
    getStateRef = () => window.S;
    applyStateRef = applyState;

    if (!isConfigured()) {
      const local = loadFromLocal();
      applyState(local || getDefaultState());
      setStatus('offline', 'Mode local');
      return { mode: 'local' };
    }

    setStatus('loading', 'Connexion…');

    try {
      initClient();
      const row = await fetchRemote();
      let state;

      if (row && !isEmptyState(row.data)) {
        state = row.data;
        lastRemoteAt = row.updated_at;
      } else {
        state = getDefaultState();
        try {
          await pushState(state);
        } catch (pushErr) {
          console.warn('Initial seed failed:', pushErr);
        }
      }

      applyState(state);
      saveToLocal(state);
      subscribeChannel();
      startPolling();
      setStatus('synced', 'Connecté');
      return { mode: 'remote' };
    } catch (err) {
      console.error('Genzy init error:', err);
      const fallback = loadFromLocal() || getDefaultState();
      applyState(fallback);
      setStatus('error', 'Connexion échouée');
      return { mode: 'fallback' };
    }
  }

  function save(getState) {
    getStateRef = getState;
    if (!isConfigured() || !supabase) {
      saveToLocal(getState());
      setStatus('offline', 'Hors ligne');
      return;
    }
    scheduleSave(getState);
  }

  function destroy() {
    clearTimeout(saveTimer);
    stopPolling();
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
