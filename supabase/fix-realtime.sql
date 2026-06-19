-- À exécuter dans Supabase SQL Editor si la sync temps réel ne marche pas

alter table dashboard_state replica identity full;

-- Activer Realtime sur la table (ignorer si déjà fait)
alter publication supabase_realtime add table dashboard_state;
