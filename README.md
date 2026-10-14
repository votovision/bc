# bc

Modèle de prévision des élections générales de la Colombie-Britannique (Votoscope).

## Organisation

| Dossier | Contenu |
|---|---|
| `src/` | Moteur commun : tendance des sondages par processus gaussien en log-ratios isométriques, compositions, résumés de simulation. |
| `lib/` | Modèle de la Colombie-Britannique : swing par transfert avec présence des partis, ventilations régionales, simulation des sièges. |
| `tools/` | Validation (transitions 2017-2020 et 2020-2024) et prévision courante (`project_now.mjs`). |
| `ingest/` | Entrées du modèle tirées du dépôt de données `votoscope/data`. |
| `data/` | Entrées et sorties du modèle (JSON). |

## Utilisation

Le dépôt de données `votoscope/data` est cloné à côté (`../data`).

```
npm install
npm run donnees                  # ../data/csv -> data/*.json
node tools/eve_national.mjs      # tendances de veille 2020 et 2024
node tools/swing_form.mjs        # validation de la forme du swing
node tools/incumbency_test.mjs    # validation de l'effet des député.es sortant.es
node tools/eve_simulation.mjs --couverture --mixte   # validation hors échantillon (configuration retenue)
npm run projection               # prévision courante -> data/bc_dashboard.json
node tools/make_tiles.mjs        # carte en tuiles (après un redécoupage)
```

## Licence

GNU GPL v3 (`LICENSE`).
