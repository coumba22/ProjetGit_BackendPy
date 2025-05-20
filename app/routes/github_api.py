from flask import Blueprint, jsonify, request
from github import Github
from app.utils import lire_repos
import os
from collections import defaultdict


github_api = Blueprint('github_api', __name__)

# Récupération du token depuis les variables d'environnement
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "REMOVED")
g = Github(GITHUB_TOKEN)

# Route API pour récupérer les commits d'un seul repo
@github_api.route('/commits', methods=['GET'])
def get_commits():
    owner = request.args.get('owner')
    repo_name = request.args.get('repo')

    if not owner or not repo_name:
        return jsonify({"error": "Merci de fournir les paramètres 'owner' et 'repo'"}), 400

    try:
        repo = g.get_repo(f"{owner}/{repo_name}")
        commits = repo.get_commits()
        result = []
        for commit in commits[:10]:
            stats = commit.stats
            result.append({
                "sha": commit.sha,
                "author": commit.author.login if commit.author else "Inconnu",
                "message": commit.commit.message,
                "date": commit.commit.author.date.isoformat(),
                "files_changed": len(list(commit.files)),
                "additions": stats.additions,
                "deletions": stats.deletions,
                "total_changes": stats.total
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Fonction pour récupérer les commits pour plusieurs repos (utilitaire)

# Pour stocker les stats globales
commit_stats = defaultdict(lambda: {
    "commits": 0,
    "additions": 0,
    "deletions": 0,
    "files_changed": 0
})

def get_commits_for_repos(token):
    g = Github(token)
    repos = lire_repos()

    for repo in repos:
        owner = repo.get("owner")
        repo_name = repo.get("repo")
        if not owner or not repo_name:
            continue

        try:
            repo_obj = g.get_repo(f"{owner}/{repo_name}")
            commits = repo_obj.get_commits()
            for commit in commits[:10]:  # Change ici si tu veux plus de commits

                author = commit.author.login if commit.author else "Inconnu"
                stats = commit.stats

                commit_stats[author]["commits"] += 1
                commit_stats[author]["additions"] += stats.additions
                commit_stats[author]["deletions"] += stats.deletions
                commit_stats[author]["files_changed"] += len(list(commit.files))

        except Exception as e:
            print(f"Erreur pour {owner}/{repo_name} : {e}")

    return commit_stats  # Important !

   
