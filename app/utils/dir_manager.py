import os
import subprocess
from urllib.parse import urlparse
from pathlib import Path
from git import Repo, GitCommandError, InvalidGitRepositoryError  # nécessite 'pip install gitpython'

import logging
from flask import current_app as app
import shutil
from flask_restful import Resource, reqparse


class DirManager(Resource):
    @staticmethod
    def name_from_url(repo_url):
        """Extrait le nom du repo depuis l'URL Git (gère .git proprement et nettoie un '-' initial)"""
        path = urlparse(repo_url).path
        repo = os.path.basename(path)
        if repo.endswith(".git"):
            repo = repo[:-4]
        #app.logger.debug(f"Nom du dépôt extrait : {repo}")
        return repo

    @staticmethod
    def is_valid_git_repo(path):
        try:
            _ = Repo(path)
            return True
        except InvalidGitRepositoryError:
            return False
        except Exception:
            return False

    @staticmethod
    def ensure_full_clone(repo_path):
        try:
            repo = Repo(repo_path)
            git = repo.git
            is_shallow = (git.rev_parse('--is-shallow-repository') == 'true')
            if is_shallow:
                app.logger.debug("Shallow repository detected, fetching full history...")
                git.fetch('--unshallow')
                app.logger.debug("Full history fetched.")

            # Fetch all branches
            git.fetch('--all')
            for remote_branch in repo.remotes.origin.refs:
                branch_name = remote_branch.remote_head
                if branch_name == 'HEAD':
                    continue
                if branch_name not in repo.heads:
                    try:
                        git.checkout('-b', branch_name, f'origin/{branch_name}')
                    except Exception as e:
                        app.logger.warning(f"Impossible de créer la branche locale '{branch_name}': {e}")

        except GitCommandError as e:
            raise Exception(f"Erreur Git : {e}")
        except Exception as e:
            raise Exception(f"Erreur inattendue : {e}")

    @staticmethod
    def clone_update_repo(repo_url, base_dir="/clones"):
        repo_name = DirManager.name_from_url(repo_url)
        clone_path = Path(base_dir) / repo_name
        clone_path.parent.mkdir(parents=True, exist_ok=True)

        token = os.environ.get("GITHUB_TOKEN")
        if not token:
            raise EnvironmentError("La variable d'environnement GITHUB_TOKEN est absente.")

        if repo_url.startswith("https://github.com/"):
            repo_url_with_token = repo_url.replace(
                "https://github.com/",
                f"https://{token}@github.com/"
            )
        else:
            raise ValueError("L'URL du dépôt doit commencer par 'https://github.com/'")

        clone_path_str = str(clone_path)
        if clone_path.exists() and DirManager.is_valid_git_repo(clone_path_str):
            try:
                subprocess.check_call(["git", "-C", clone_path_str, "pull"])
                app.logger.debug(f"{clone_path} mis à jour.")
            except subprocess.CalledProcessError as e:
                raise Exception(f"Erreur lors de la mise à jour du dépôt : {e}")
        else:
            if clone_path.exists():
                app.logger.debug(f"{clone_path} n'est pas un dépôt Git valide, on écrase ce dossier.")
                shutil.rmtree(clone_path)

            try:
                subprocess.check_call([
                    "git", "clone", "--no-single-branch", repo_url_with_token, clone_path_str
                ])
                app.logger.debug(f"{clone_path} cloné.")
            except subprocess.CalledProcessError as e:
                raise Exception(f"Erreur lors du clonage du dépôt : {e}")

        DirManager.ensure_full_clone(clone_path_str)

        return clone_path_str

    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('repo_url', required=True, help="Le paramètre 'repo_url' est obligatoire.")
        args = parser.parse_args()

        repo_url = args['repo_url']

        try:
            path = self.clone_update_repo(repo_url)
            return {"clone_path": path, "message": "Clone ou mise à jour réussie."}, 200
        except Exception as e:
            return {"error": str(e)}, 500
