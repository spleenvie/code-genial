# Genzy

Tableau de bord collaboratif pour la gestion de clients, tâches et suivi d'activité.

## Site en ligne

https://spleenvie.github.io/code-genial/

## Synchronisation temps réel

Les données sont stockées dans **Supabase** (PostgreSQL). Quand quelqu'un modifie le tableau de bord, les autres utilisateurs voient la mise à jour en direct.

Indicateur en bas de la sidebar :
- **Vert** — synchronisé, temps réel actif
- **Orange** — enregistrement en cours
- **Gris** — mode local (Supabase non configuré)

---

## Configuration Supabase (une seule fois)

### 1. Créer un projet Supabase

1. Va sur [supabase.com](https://supabase.com) et crée un compte gratuit
2. **New project** → choisis un nom (ex. `genzy`)
3. Note l'URL et la clé **anon public** : **Project Settings → API**

### 2. Créer la table

Dans **SQL Editor**, exécute le contenu de [`supabase/schema.sql`](supabase/schema.sql).

### 3. Activer le temps réel

Dans **Database → Replication**, vérifie que `dashboard_state` est activé pour Realtime.

### 4. Configurer GitHub (pour le site en ligne)

Dans ton repo GitHub → **Settings → Secrets and variables → Actions**, ajoute :

| Secret | Valeur |
|--------|--------|
| `SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | ta clé anon publique |

Puis relance le déploiement : **Actions → Deploy GitHub Pages → Run workflow**

### 5. Développement local

Édite `config.js` avec tes identifiants Supabase :

```javascript
window.GENZY_CONFIG = {
  supabaseUrl: 'https://xxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};
```

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

---

## Utilisation

Ouvre le site depuis plusieurs navigateurs ou appareils. Toute modification (tâche cochée, client ajouté, note modifiée…) est visible par tous en quelques secondes.

Les boutons **Export / Import** restent disponibles pour sauvegarder ou restaurer manuellement les données.
