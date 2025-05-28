from flask import Blueprint, jsonify
from github import Github
from app.utils import lire_repos
import os
from dotenv import load_dotenv

stats_api = Blueprint('stats_api', __name__)


load_dotenv()
#g = Github(os.getenv("GITHUB_TOKEN"))

@stats_api.route('/stats', methods=['GET'])
def get_stats():
    #g = Github(GITHUB_TOKEN)
    g = Github(os.getenv("GITHUB_TOKEN"))
    repos = lire_repos()

    stats_data = {
        "total_commits": 0,
        "authors": {}
    }

    for repo_info in repos:
        try:
            repo = g.get_repo(f"{repo_info['owner']}/{repo_info['repo']}")
            commits = repo.get_commits()
            for commit in commits[:10]:  # Tu peux augmenter le nombre
                author = commit.author.login if commit.author else "Inconnu"
                stats = commit.stats

                # Si auteur pas encore dans les stats, initialiser
                if author not in stats_data["authors"]:
                    stats_data["authors"][author] = {
                        "commits": 0,
                        "additions": 0,
                        "deletions": 0,
                        "files_changed": 0
                    }

                stats_data["total_commits"] += 1
                stats_data["authors"][author]["commits"] += 1
                stats_data["authors"][author]["additions"] += stats.additions
                stats_data["authors"][author]["deletions"] += stats.deletions
                stats_data["authors"][author]["files_changed"] += len(list(commit.files))

        except Exception as e:
            print(f"Erreur avec {repo_info['repo']} : {e}")

    return jsonify(stats_data)

