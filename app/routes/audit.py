import os
import shutil
import subprocess
import time
import requests  # utilisé pour l’API GitStats
from flask_restful import Resource, reqparse
from typing import Optional, Dict, Any
from urllib.parse import urlparse
from collections import defaultdict, Counter
from datetime import datetime
from pydriller import Repository
from radon.complexity import cc_visit
import matplotlib.pyplot as plt
from flask import current_app as app # Keep current_app for logging, remove jsonify if it's still there
import requests
from ..utils.dir_manager import DirManager
from ..utils.utils import Utils

class AuditAPI(Resource):
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("repo_url", type=str, required=True)
        parser.add_argument("deadline")
        args = parser.parse_args()

        repo_url = args["repo_url"]
        deadline = args["deadline"]

        result = self.lancer_audit(repo_url, deadline)

        status_code = 200
        return {"status": "success", "result": result}, status_code
    
    def lancer_audit( self,
        repo_url: str,
        token: Optional[str] = None,
        deadline: Optional[str] = None
    ) -> Dict[str, Any]:
        timestamp = int(time.time())
        #base_name = Utils.nettoyer_nom_repo(repo_url)
        #repo_path = f"temp_repo_{timestamp}_{base_name}"
        gitstats_output_path = "static/gitstats_report"

        base_name = Utils.nettoyer_nom_repo(repo_url)        
        repo_path = DirManager.clone_update_repo(repo_url)

        # Comptages
        commits_par_auteur         = Counter()
        fichiers_modifies          = Counter()
        complexites                = {}
        evolution_par_auteur       = defaultdict(lambda: defaultdict(int))
        co_modification            = defaultdict(lambda: defaultdict(int))
        auteur_fichiers            = defaultdict(set)
        lignes_ajoutees_par_auteur = Counter()
        lignes_supprimees_par_auteur = Counter()

        try:
            for commit in Repository(repo_path).traverse_commits():
                au = commit.author.name or "Inconnu"
                dstr = commit.author_date.strftime("%Y-%m-%d")

                commits_par_auteur[au] += 1
                evolution_par_auteur[au][dstr] += 1

                for mod in commit.modified_files:
                    # fichiers
                    f = mod.new_path or mod.old_path
                    if not f:
                        continue
                    fichiers_modifies[f] += 1
                    auteur_fichiers[au].add(f)

                    # co-modifs
                    for autre, s in auteur_fichiers.items():
                        if autre != au and f in s:
                            co_modification[f][au]    += 1
                            co_modification[f][autre] += 1

                        # … à l’intérieur du for commit … for mod in commit.modified_files: …
                        # Complexité cyclomatique : on tente systématiquement (radon ne lira
                        # que le Python, et lèvera une exception sinon)
                        full_path = os.path.join(repo_path, f)
                        if os.path.exists(full_path):
                            try:
                                with open(full_path, 'r', encoding='utf-8') as f_code:
                                    code = f_code.read()
                                    res = cc_visit(code)
                                    complexites[f] = sum(c.complexity for c in res)
                            except Exception:
                                # pas un fichier Python ou parse error → on ignore
                                pass

                    # … fin de la boucle Repository(traverse_commits()) …

                    # Après avoir collecté TOUTES les complexités, on ne conserve QUE le Top 10
                    if complexites:
                        top10 = sorted(complexites.items(), key=lambda x: x[1], reverse=True)[:10]
                        complexites = dict(top10)


                    # lignes ajoutées/supprimées
                    a = getattr(mod, "added_lines", 0)
                    d = getattr(mod, "deleted_lines", 0)
                    if a:
                        lignes_ajoutees_par_auteur[au] += a
                    if d:
                        lignes_supprimees_par_auteur[au] += d

        except Exception as e:
            return {"error": f"Erreur pendant l'analyse des commits : {e}"}

        # GARDER TOP 10 des fichiers Python les plus complexes
        if complexites:
            top10 = sorted(complexites.items(), key=lambda x: x[1], reverse=True)[:10]
            complexites = dict(top10)

        # Contributions par auteur
        contributions = {}
        total_changed = 0
        for au in set(lignes_ajoutees_par_auteur) | set(lignes_supprimees_par_auteur):
            A = lignes_ajoutees_par_auteur.get(au, 0)
            D = lignes_supprimees_par_auteur.get(au, 0)
            T = A + D
            total_changed += T
            contributions[au] = {"added": A, "deleted": D, "total": T}

        # pourcentages
        for au, info in contributions.items():
            pct = round(100 * info["total"] / total_changed, 2) if total_changed > 0 else 0.0
            info["percent"] = pct

        # Création dossier images
        os.makedirs("static/images", exist_ok=True)

        # Graph Commits
        try:
            fig, ax = plt.subplots(figsize=(8,4))
            ax.bar(commits_par_auteur.keys(), commits_par_auteur.values(), color='skyblue')
            ax.set_title("Commits par auteur")
            ax.tick_params(axis='x', rotation=45)
            plt.tight_layout()
            p = f"static/images/{base_name}_commits.png"
            plt.savefig(p); plt.close(fig)
            graph_url = p.replace("\\", "/")
        except:
            graph_url = None

        # Graph Évolution
        try:
            fig, ax = plt.subplots(figsize=(10,5))
            for au, dates in evolution_par_auteur.items():
                xs = sorted(dates)
                ys = [dates[d] for d in xs]
                dx = [datetime.strptime(d, "%Y-%m-%d") for d in xs]
                ax.plot(dx, ys, marker='o', label=au)
            if deadline:
                dl = datetime.strptime(deadline, "%Y-%m-%d")
                ax.axvline(dl, color='black', linestyle='--', label='Deadline')
            ax.set_title("Évolution temporelle")
            ax.set_xlabel("Date"); ax.set_ylabel("Commits")
            ax.tick_params(axis='x', rotation=45)
            ax.legend()
            plt.tight_layout()
            p2 = f"static/images/{base_name}_evolution.png"
            plt.savefig(p2); plt.close(fig)
            evolution_url = p2.replace("\\", "/")
        except:
            evolution_url = None

        fichiers_critiques = fichiers_modifies.most_common(5)

        # Appel API GitStats
        '''gitstats_url = None
        try:
            resp = requests.post(
                "http://127.0.0.1:5000/api/gitstats",
                json={
                    "repo_path": os.path.abspath(repo_path),
                    "output_path": os.path.abspath(gitstats_output_path)
                }
            )
            data = resp.json()
            if data.get("success"):
                gitstats_url = "/static/gitstats_report/index.html"
        except Exception as e:
            print("❌ Exception GitStats :", e)'''

        # Nettoyage du clone
        '''try:
            Utils.fermer_processus_git(repo_path)
            shutil.rmtree(repo_path, onerror=Utils.on_rm_error)
        except Exception as e:
            print("❌ Erreur nettoyage :", e)'''

        return {
            "total_commits":          sum(commits_par_auteur.values()),
            "commits_par_auteur":     dict(commits_par_auteur),
            "contributions":          contributions,
            "fichiers_critiques":     fichiers_critiques,
            "complexites":            complexites,
            "co_modification":        {f: dict(a) for f,a in co_modification.items()},
            "graph_url":              graph_url,
            "evolution_url":          evolution_url
            #"gitstats_url":           gitstats_url
        }