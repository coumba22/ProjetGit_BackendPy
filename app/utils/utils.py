import os
import json
import stat
from typing import Optional,Dict
from urllib.parse import urlparse
import psutil
from flask import current_app as app 



class Utils:

    # -------------------------------------------------------------------
    #            Chargement du fichier tds.json (liste des étudiants)
    # --------------------------------------------------------------------
    @staticmethod
    def charger_tds(tds_path: str = "data/tds.json") -> (
        Dict[str, str],
        Dict[str, str],
        Dict[str, Dict[str, str]]
    ):
        app.logger.debug(tds_path)
        """
        Ouvre 'tds.json' et retourne :
        - liste_etudiants : { "Alice": "url_repo_Alice", … }
        - token_communs   : { "Alice": "ghp_XXX", … } (seulement s’il y a un token non vide)
        - deadlines_map   : { "Alice": {"2025-03-07": "18:00", … }, "Bob": {…} }

        Si le fichier est absent ou vide, renvoie trois dicts vides.
        """
        if not os.path.exists(tds_path):
            app.logger.debug("tds.json not found")
            return {}, {}, {}
        try:
            with open(tds_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            return {}, {}, {}

        liste_etudiants: Dict[str, str] = {}
        token_communs: Dict[str, str] = {}
        deadlines_map: Dict[str, Dict[str, str]] = {}

        for item in data:
            nom = item.get("nom")
            url = item.get("repo_url")
            token = item.get("token", "")
            raw_dead = item.get("deadlines")
            single_dead = item.get("deadline")

            if nom and url:
                liste_etudiants[nom] = url
                if token:
                    token_communs[nom] = token

                if isinstance(raw_dead, dict):
                    deadlines_map[nom] = raw_dead
                elif isinstance(single_dead, str) and single_dead.strip():
                    deadlines_map[nom] = {"global": single_dead.strip()}
                else:
                    deadlines_map[nom] = {}

        return liste_etudiants, token_communs, deadlines_map

    @staticmethod
    def lire_repos():
        try:
            with open("data/repos.json", "r") as f:
                data = json.load(f)

            # Vérifie si la clé "repos" est présente
            if "repos" in data:
                return data["repos"]
            else:
                print("Le fichier JSON ne contient pas de clé 'repos'.")
                return []
        except Exception as e:
            print(f"Erreur lors de la lecture du fichier JSON : {e}")
            return []

    @staticmethod
    def lire_tds():
        try:
            with open("data/tds.json", "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Erreur lecture tds.json : {e}")
            return {}

    @staticmethod
    def lire_groupes():
        import json
        with open("data/groupes.json", "r") as f:
            return json.load(f)
        
    @staticmethod
    def on_rm_error(func, path, exc_info):
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
        except Exception as e:
            print(f"❌ Échec suppression {path} : {e}")

    @staticmethod
    def fermer_processus_git(path: str) -> None:
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                nom = proc.info['name'] or ""
                cmdl = proc.info['cmdline'] or []
                if ('git' in nom.lower() or 'gitstats' in nom.lower()) and any(path in arg for arg in cmdl):
                    proc.terminate()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    
    @staticmethod
    def inject_token_in_url(repo_url: str, token: Optional[str]) -> str:
        parsed = urlparse(repo_url)
        path = parsed.path
        if not path.endswith(".git"):
            path += ".git"
        if token:
            return f"https://{token}@{parsed.netloc}{path}"
        else:
            return f"https://{parsed.netloc}{path}"

    @staticmethod
    def nettoyer_nom_repo(url: str) -> str:
        path = urlparse(url).path
        repo_name = os.path.basename(path)
        return repo_name.replace(".git", "")