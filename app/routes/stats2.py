from flask_restful import Resource

import os
import shutil
import subprocess
import time
 # utilisé pour l’API GitStats

from typing import Optional, Dict, Any
from flask import render_template, jsonify 
from flask import current_app as app 
import matplotlib.pyplot as plt
from urllib.parse import urlparse
from datetime import datetime
from pydriller import Repository
from ..utils.dir_manager import DirManager
from ..utils.utils import Utils


class StatsAPI(Resource):
    def post(self):
        """
        Charge tds.json, analyse chaque dépôt d’étudiant, puis affiche
        le tableau complet dans stats.html (avec graphique ‘score global’).
        """
        # 1) Charger le fichier tds.json
        # Mis directement dans analyser_classe pour une eilleure cohérence
        '''liste_etudiants, token_communs, deadlines_map = Utils.charger_tds()
        if not liste_etudiants:
            # Si aucun étudiant dans tds.json, on affiche un tableau vide
            #return render_template('stats.html', résultats_classe={}, graph_classe_url=None)
            error_message = f"No students found"
            status_code = 400
            app.logger.error(f"No students found", exc_info=True)
            return {"error": error_message}, status_code'''
        
        
        # 2) on appelle analyser_classe qui charge la liste des étudiants 
        # et fait chacun l'analyse de leurs TDs
        #résultats_classe = self.analyser_classe(liste_etudiants, token_communs, deadlines_map, poids=None)
        résultats_classe = self.analyser_classe()

        '''# 3) Générer un graphique « Score global par étudiant »
        noms = list(résultats_classe.keys())
        scores = [
            résultats_classe[n]["score_global"] if "score_global" in résultats_classe[n] else 0.0
            for n in noms
        ]
        # Créer le dossier si nécessaire
        os.makedirs("static/images", exist_ok=True)
        graph_classe_path = "static/images/classe_score.png"
        try:
            plt.figure(figsize=(8, 4))
            plt.bar(noms, scores, color='mediumseagreen')
            plt.title("Score global par étudiant")
            plt.xticks(rotation=45)
            plt.tight_layout()
            plt.savefig(graph_classe_path)
            plt.close()
            # URL relative à passer au template
            graph_classe_url = "/" + graph_classe_path.replace("\\", "/")
        except Exception:
            graph_classe_url = None

        # 4) Renvoyer le template
        return render_template(
            'stats.html',
            résultats_classe=résultats_classe,
            graph_classe_url=graph_classe_url
        )'''
        status_code = 200
        return {"status": "success", "resultatsClasse":résultats_classe}, status_code
    

    def analyser_etudiant( self,
        nom_etudiant: str,
        repo_url: str,
        token: Optional[str],
        deadlines_etudiant: Dict[str, str],
        poids: Optional[Dict[str, float]]
    ) -> Dict[str, Any]:
        """
        Pour un étudiant donné :
        - clone son dépôt dans 'temp_etudiant_<nom>_<timestamp>',
        - pour chaque commit du samedi (weekday() == 5), calcule
            'ajouts', 'suppressions', 'fichiers touchés', 'score_TD',
            'pourcentage' (par rapport au total de lignes modifiées),
            indique s’il est à l’heure ou non (en comparant l’heure du commit
            à la deadline de ce samedi tirée de deadlines_etudiant),
        - renvoie un dict :
            {
                "etudiant": "<nom_repo>",
                "TDs": {
                "YYYY-MM-DD": {
                    "date_commit": "YYYY-MM-DD HH:MM",
                    "commits": N,
                    "ajouts": A,
                    "suppressions": S,
                    "fichiers": F,
                    "score": X.X,
                    "pourcentage": Y.Y,       # % du total de lignes modifiées
                    "a_heure": True/False
                }, …
                },
                "total_commits": …,
                "total_ajouts": …,
                "total_suppressions": …,
                "total_fichiers": …,
                "score_global": …,
                "nb_branches": …,
                "nb_pulls_all": …,
                "nb_issues_all": …
            }
        """
        '''base_name = nettoyer_nom_repo(repo_url)
        ts = int(time.time())
        repo_path = f"temp_etudiant_{base_name}_{ts}"
        if os.path.exists(repo_path):
            fermer_processus_git(repo_path)
            shutil.rmtree(repo_path, onerror=on_rm_error)

        # 1) Cloner le dépôt
        url_to_clone = inject_token_in_url(repo_url, token)
        try:
            subprocess.check_call(["git", "clone", url_to_clone, repo_path])
            time.sleep(0.5)
        except subprocess.CalledProcessError:
            return {"error": f"❌ Clonage échoué pour {nom_etudiant}."}'''
        
        base_name = Utils.nettoyer_nom_repo(repo_url)        
        repo_path = DirManager.clone_update_repo(repo_url)

        # 2) Initialisation des compteurs
        TDs: Dict[str, Dict[str, Any]] = {}
        total_commits = 0
        total_ajouts = 0
        total_suppressions = 0
        total_fichiers = 0
        score_global = 0.0

        # 3) Pondérations par défaut si non fournies
        if poids is None:
            w_c = 1.0    # poids sur nombre de commits
            w_l = 0.5    # poids sur lignes (ajouts + suppressions)
            w_f = 0.2    # poids sur fichiers touchés
        else:
            w_c = poids.get("commits", 1.0)
            w_l = poids.get("ligne", 0.5)
            w_f = poids.get("fichier", 0.2)

        # 4) Itérer sur tous les commits avec PyDriller
        try:
            for commit in Repository(repo_path).traverse_commits():
                dt = commit.author_date
                # Ne retenir que les samedis (weekday()==5)
                if dt.weekday() != 5:
                    continue

                date_semaine = dt.strftime("%Y-%m-%d")
                if date_semaine not in TDs:
                    TDs[date_semaine] = {
                        "date_commit": dt.strftime("%Y-%m-%d %H:%M"),
                        "commits": 0,
                        "ajouts": 0,
                        "suppressions": 0,
                        "fichiers": 0,
                        "score": 0.0,
                        "pourcentage": 0.0,
                        "a_heure": True
                    }

                # Incrémenter le nombre de commits
                TDs[date_semaine]["commits"] += 1

                # Parcourir les modifications de fichiers
                ajouts = 0
                suppressions = 0
                fichiers_touchés = 0
                for mod in commit.modified_files:
                    a = getattr(mod, "added_lines", 0)
                    d = getattr(mod, "deleted_lines", 0)
                    ajouts += a
                    suppressions += d
                    fichiers_touchés += 1

                TDs[date_semaine]["ajouts"] += ajouts
                TDs[date_semaine]["suppressions"] += suppressions
                TDs[date_semaine]["fichiers"] += fichiers_touchés

                # 5) Vérifier la deadline pour ce samedi
                #    deadlines_etudiant : { "YYYY-MM-DD": "HH:MM", … } ou {"global": "HH:MM"}
                if date_semaine in deadlines_etudiant:
                    limite_str = f"{date_semaine} {deadlines_etudiant[date_semaine]}"
                    try:
                        dt_limite = datetime.strptime(limite_str, "%Y-%m-%d %H:%M")
                        if dt > dt_limite:
                            TDs[date_semaine]["a_heure"] = False
                    except Exception:
                        pass
                elif "global" in deadlines_etudiant:
                    limite_str = f"{date_semaine} {deadlines_etudiant['global']}"
                    try:
                        dt_limite = datetime.strptime(limite_str, "%Y-%m-%d %H:%M")
                        if dt > dt_limite:
                            TDs[date_semaine]["a_heure"] = False
                    except Exception:
                        pass

                # 6) Calcul du score pour ce TD
                score_TD = (
                    TDs[date_semaine]["commits"] * w_c
                    + (TDs[date_semaine]["ajouts"] + TDs[date_semaine]["suppressions"]) * w_l
                    + TDs[date_semaine]["fichiers"] * w_f
                )
                TDs[date_semaine]["score"] = round(score_TD, 2)

                # Maj totaux
                total_commits += TDs[date_semaine]["commits"]
                total_ajouts += TDs[date_semaine]["ajouts"]
                total_suppressions += TDs[date_semaine]["suppressions"]
                total_fichiers += TDs[date_semaine]["fichiers"]
                score_global += score_TD

            # 7) Calculer les pourcentages par TD (par rapport au total de lignes modifiées)
            total_lignes = total_ajouts + total_suppressions
            if total_lignes > 0:
                for info in TDs.values():
                    lignes_td = info["ajouts"] + info["suppressions"]
                    info["pourcentage"] = round(100.0 * lignes_td / total_lignes, 2)
            else:
                for info in TDs.values():
                    info["pourcentage"] = 0.0

        except Exception as e:
            return {"error": f"Erreur pendant l’analyse des TDs de {nom_etudiant} : {e}"}

            # 8) Récupérer quelques indicateurs GitHub (branches, PR, issues, reviews, CI/CD)
        nb_branches = nb_pr_total = nb_pr_open = nb_pr_closed = nb_pr_merged = 0
        nb_reviews = 0
        nb_ci_total = nb_ci_success = nb_ci_failure = 0

        try:
            from requests import get as _get
            parsed = urlparse(repo_url)
            owner, repo = parsed.path.strip("/").replace(".git", "").split("/", 1)
            headers = {"Accept": "application/vnd.github.v3+json"}
            if token:
                headers["Authorization"] = f"token {token}"

            # -- Branches
            bres = _get(f"https://api.github.com/repos/{owner}/{repo}/branches", headers=headers)
            if bres.ok:
                nb_branches = len(bres.json())

            # -- Pull‐requests (toutes)
            prs = []
            page = 1
            while True:
                r = _get(
                    f"https://api.github.com/repos/{owner}/{repo}/pulls?state=all&per_page=100&page={page}",
                    headers=headers
                )
                if not r.ok:
                    break
                batch = r.json()
                if not batch:
                    break
                prs.extend(batch)
                page += 1
            nb_pr_total  = len(prs)
            nb_pr_open   = sum(1 for pr in prs if pr.get("state") == "open")
            nb_pr_closed = sum(1 for pr in prs if pr.get("state") == "closed")
            nb_pr_merged = sum(1 for pr in prs if pr.get("merged_at") is not None)

            # -- Code reviews
            for pr in prs:
                num = pr.get("number")
                rr = _get(f"https://api.github.com/repos/{owner}/{repo}/pulls/{num}/reviews", headers=headers)
                if rr.ok:
                    nb_reviews += len(rr.json())

            # -- CI/CD via GitHub Actions
            runs = []
            page = 1
            while True:
                cr = _get(
                    f"https://api.github.com/repos/{owner}/{repo}/actions/runs?per_page=100&page={page}",
                    headers=headers
                )
                if not cr.ok:
                    break
                data = cr.json().get("workflow_runs", [])
                if not data:
                    break
                runs.extend(data)
                page += 1
            nb_ci_total   = len(runs)
            nb_ci_success = sum(1 for run in runs if run.get("conclusion") == "success")
            nb_ci_failure = sum(1 for run in runs if run.get("conclusion") not in (None, "success"))

        except Exception as e:
            # en cas d’erreur, on laisse tout à 0
            print(f"❌ Erreur GitHub API pour {owner}/{repo} : {e}")

        # 9) Nettoyage du clone (Ne pas nettoyer le clone car cela 
        # permet de ne pas le retélécharger à chaque fois)
        '''try:
            Utils.fermer_processus_git(repo_path)
            shutil.rmtree(repo_path, onerror=Utils.on_rm_error)
        except Exception as e:
            print(f"❌ Erreur nettoyage pour {nom_etudiant} : {e}")'''


        # 10) Retour avec les nouveaux champs
        return {
            "etudiant": base_name,
            "TDs": TDs,
            "total_commits": total_commits,
            "total_ajouts": total_ajouts,
            "total_suppressions": total_suppressions,
            "total_fichiers": total_fichiers,
            "score_global": round(score_global, 2),
            "nb_branches": nb_branches,
            "nb_pr_total": nb_pr_total,
            "nb_pr_open": nb_pr_open,
            "nb_pr_closed": nb_pr_closed,
            "nb_pr_merged": nb_pr_merged,
            "nb_reviews": nb_reviews,
            "nb_ci_total": nb_ci_total,
            "nb_ci_success": nb_ci_success,
            "nb_ci_failure": nb_ci_failure
        }
    

    def analyser_classe( self) -> Dict[str, Any]:
        """
        Itère sur tous les étudiants de 'liste_etudiants':
        - pour chaque étudiant, appelle analyser_etudiant(...)
        - stocke le résultat dans un dict { nom_etudiant: résultat }
        Retourne ce dict.

        liste_etudiants : { "Alice": "https://..alice.git", "Bob": "..." }
        token_communs   : { "Alice": "ghp_XXX", "Bob": "ghp_YYY" } (optional)
        deadlines_map   : { "Alice": {"2025-03-07":"18:00", ...}, "Bob": {...} }
        poids           : { "commits": 1.0, "ligne": 0.5, "fichier": 0.2 }
        """

        poids = None
        liste_etudiants, token_communs, deadlines_map = Utils.charger_tds()
        if not liste_etudiants:
            # Si aucun étudiant dans tds.json, on affiche un tableau vide
            #return render_template('stats.html', résultats_classe={}, graph_classe_url=None)
            error_message = f"No students found"
            status_code = 400
            app.logger.error(f"No students found", exc_info=True)
            return {"error": error_message}, status_code

        résultats_totaux: Dict[str, Any] = {}

        for nom, url_repo in liste_etudiants.items():
            token = token_communs.get(nom) if token_communs else None
            deadlines_etudiant = deadlines_map.get(nom, {})
            try:
                print(f"▶️ Analyse de {nom} ({url_repo}) …")
                res = self.analyser_etudiant(nom, url_repo, token, deadlines_etudiant, poids)
                résultats_totaux[nom] = res
            except Exception as e:
                résultats_totaux[nom] = {"error": f"Exception inattendue pour {nom} : {e}"}

        return résultats_totaux
    
    

