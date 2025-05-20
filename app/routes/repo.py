# Gestion des dépôts et analyses  

from flask import Blueprint, jsonify
from app.routes.github_api import get_stats_for_repos  
# fonction à créer pour récupérer stats

repo_bp = Blueprint('repo', __name__)

@repo_bp.route('/stats')
def stats():
    try:
        stats_data = get_stats_for_repos()
        return jsonify(stats_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
