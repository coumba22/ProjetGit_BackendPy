import subprocess
import os
import shutil
from urllib.parse import urlparse


def nom_repo_depuis_url(repo_url):
    """Extrait le nom du repo depuis l'URL Git"""
    path = urlparse(repo_url).path  # ex: /user/repo.git
    repo = os.path.basename(path)   # ex: repo.git
    if repo.endswith(".git"):
        repo = repo[:-4]
    return repo

def cloner_ou_update_repo(repo_url, base_dir="./clones"):
    """
    Clone ou met à jour le dépôt git dans base_dir
    Retourne le chemin local vers le repo.
    """
    if not os.path.exists(base_dir):
        os.makedirs(base_dir)

    repo_name = nom_repo_depuis_url(repo_url)
    repo_path = os.path.join(base_dir, repo_name)

    if os.path.exists(repo_path):
        # Mise à jour du dépôt
        try:
            subprocess.check_call(["git", "-C", repo_path, "pull"])
        except subprocess.CalledProcessError as e:
            raise Exception(f"Erreur lors de la mise à jour du dépôt : {e}")
    else:
        # Cloner le dépôt
        try:
            subprocess.check_call(["git", "clone", repo_url, repo_path])
        except subprocess.CalledProcessError as e:
            raise Exception(f"Erreur lors du clonage du dépôt : {e}")

    return repo_path

def generer_gitstats(repo_path, output_path):
    if not os.path.exists(repo_path):
        return {"error": "Le repo n'existe pas."}

    try:
        if os.path.exists(output_path):
            shutil.rmtree(output_path)

        os.makedirs(output_path, exist_ok=True)

        subprocess.check_call([
            "python3",
            "/opt/gitstats/gitstats.py",
            "--format", "markdown",
            repo_path,
            output_path
        ])

        return {"success": True}
    except subprocess.CalledProcessError as e:
        return {"error": f"GitStats a échoué : {e}"}
    except Exception as e:
        return {"error": str(e)}
