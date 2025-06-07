from github import Github
from app.utils.utils import lire_repos  # fonction qui lit repos.json

import os
from dotenv import load_dotenv


load_dotenv()
g = Github(os.getenv("GITHUB_TOKEN"))


#g = Github(GITHUB_TOKEN)

def get_stats_for_repos():
    repos = lire_repos()  # liste de dict {owner, repo}
    stats = {}

    for repo in repos:
        full_name = f"{repo['owner']}/{repo['repo']}"
        repository = g.get_repo(full_name)
        commits = repository.get_commits()

        for commit in commits:
            author = commit.author.login if commit.author else "Inconnu"
            stats[author] = stats.get(author, 0) + 1
    return stats
